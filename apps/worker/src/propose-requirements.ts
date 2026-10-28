import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MeteredResponsesRunner,
  GeminiGenerateContentTransport,
  OpenAIResponsesTransport,
  type BudgetGateway,
  type MeteredRequest,
  type MeteredRunResult,
  type ModelRate,
  type ResponsesTransport,
} from "@papertrail/ai";
import { decryptApiKey, resolveAiCredentialEncryptionSecret } from "./ai-credential-vault.js";
import type { ClaimedJob, OwnerAiProviderCredential, PrivateRequirementProposalSource, WorkerRepository } from "@papertrail/db";
import { parseRequirementProposals } from "@papertrail/domain";
import type { JobHandler } from "./durable-worker.js";

const maximumCountedInputTokens = 8_000;
const maximumOutputTokens = 1_500;
const sourceHashPattern = /^[A-Fa-f0-9]{64}$/;
const promptVersion = "requirement-proposal-v1";

interface RateCard {
  models: Record<string, {
    inputNanoPerToken: number;
    cachedInputNanoPerToken: number;
    cacheWriteNanoPerToken: number;
    outputNanoPerToken: number;
  }>;
}

export interface RequirementProposalConfig {
  apiKey: string;
  model: string;
  prompt: string;
  promptVersion: string;
  rate: ModelRate;
}

export interface RequirementProposalRunner {
  run(request: MeteredRequest): Promise<MeteredRunResult>;
}

export interface OwnerSuppliedProviderRunner {
  run(credential: OwnerAiProviderCredential, apiKey: string, request: { input: string; instructions: string; maxOutputTokens: number; requestId: string; runId: string }): Promise<{ id: string; outputText: string }>;
}

export type InputTokenCounter = (apiKey: string, model: string, instructions: string, input: string) => Promise<number>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for requirement proposals.`);
  return value;
}

function parseRate(value: RateCard["models"][string]): ModelRate {
  const entries = Object.values(value);
  if (!entries.every((entry) => Number.isSafeInteger(entry) && entry >= 0)) throw new Error("RATE_CARD_INVALID");
  return {
    inputNanoPerToken: BigInt(value.inputNanoPerToken),
    cachedInputNanoPerToken: BigInt(value.cachedInputNanoPerToken),
    cacheWriteNanoPerToken: BigInt(value.cacheWriteNanoPerToken),
    outputNanoPerToken: BigInt(value.outputNanoPerToken),
  };
}

/** Uses the provider counter; character-count estimates are deliberately forbidden. */
export async function countOpenAIInputTokens(apiKey: string, model: string, instructions: string, input: string): Promise<number> {
  const response = await fetch("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input }),
  });
  if (!response.ok) throw new Error(`OPENAI_INPUT_TOKEN_COUNT_HTTP_${response.status}`);
  const body = await response.json() as { input_tokens?: unknown };
  const inputTokens = body.input_tokens;
  if (typeof inputTokens !== "number" || !Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new Error("OPENAI_INPUT_TOKEN_COUNT_INVALID");
  return inputTokens;
}

function buildSourceInput(sourceText: string, sourceContentSha256: string): string {
  return `SOURCE_CONTENT_SHA256: ${sourceContentSha256}\n\nSOURCE_TEXT:\n${sourceText}`;
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "REQUIREMENT_PROPOSAL_FAILED";
}

function isBudgetError(code: string): boolean {
  return code === "BUDGET_PAUSED" || code.startsWith("BUDGET_CAMPAIGN_") || code.startsWith("BUDGET_OWNER_") || code.startsWith("BUDGET_RUN_");
}

interface RequirementProposalPayload {
  proposalRunId: string;
  deletionGeneration: number;
}

function parsePayload(value: unknown): RequirementProposalPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<RequirementProposalPayload>;
  if (typeof payload.proposalRunId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.proposalRunId)) return null;
  if (!Number.isInteger(payload.deletionGeneration) || (payload.deletionGeneration ?? -1) < 0) return null;
  return { proposalRunId: payload.proposalRunId, deletionGeneration: payload.deletionGeneration! };
}

export class ProposeRequirementsHandler implements JobHandler {
  readonly supportedKinds = ["propose_private_requirements"] as const;

  constructor(
    private readonly repository: WorkerRepository,
    private readonly config: RequirementProposalConfig | null,
    private readonly runner: RequirementProposalRunner | null,
    private readonly countInputTokens: InputTokenCounter = countOpenAIInputTokens,
    private readonly newRequestId: () => string = randomUUID,
    private readonly byokSecret: string | null = null,
    private readonly byokPrompt = "Return only a JSON array of private requirement proposals, each cited exactly from the supplied source text.",
    private readonly byokRunner: OwnerSuppliedProviderRunner = {
      async run(credential, apiKey, request) {
        if (credential.provider === "openai") {
          const response = await new OpenAIResponsesTransport(apiKey).create({
            model: credential.model,
            input: request.input,
            instructions: request.instructions,
            maxOutputTokens: request.maxOutputTokens,
            metadata: { papertrail_request_id: request.requestId, papertrail_run_id: request.runId },
          });
          return { id: response.id, outputText: response.outputText };
        }
        return new GeminiGenerateContentTransport(apiKey).create({
          model: credential.model,
          input: request.input,
          instructions: request.instructions,
          maxOutputTokens: request.maxOutputTokens,
          metadata: { papertrail_request_id: request.requestId, papertrail_run_id: request.runId },
        });
      },
    },
  ) {}

  async handle(job: ClaimedJob): Promise<{ state: "succeeded" | "failed" | "budget_paused" | "outcome_unknown"; errorCode?: string }> {
    const payload = parsePayload(job.payload);
    if (job.owner_id === null || payload === null) return { state: "failed", errorCode: "REQUIREMENT_PROPOSAL_INVALID_JOB_PAYLOAD" };

    const source = await this.repository.beginPrivateRequirementProposal(job, payload.proposalRunId, payload.deletionGeneration);
    if (source === null) return { state: "outcome_unknown", errorCode: "REQUIREMENT_PROPOSAL_FENCE_REJECTED" };
    if (!sourceHashPattern.test(source.source_content_sha256)) return this.recordFailure(job, payload, "REQUIREMENT_PROPOSAL_SOURCE_HASH_INVALID");
    if (!source.source_text.trim()) return this.recordFailure(job, payload, "REQUIREMENT_PROPOSAL_SOURCE_EMPTY");
    const expectedPromptVersion = this.config?.promptVersion ?? promptVersion;
    if (source.prompt_version !== expectedPromptVersion) return this.recordFailure(job, payload, "REQUIREMENT_PROPOSAL_PROMPT_VERSION_UNSUPPORTED");

    const requestId = this.newRequestId();
    const input = buildSourceInput(source.source_text, source.source_content_sha256);
    const credential = await this.repository.ownerAiProviderCredential(job.owner_id);
    if (credential !== null) return this.handleOwnerSuppliedCredential(job, payload, source, credential, input, requestId);
    if (this.config === null || this.runner === null) return this.recordFailure(job, payload, "AI_PROVIDER_NOT_CONFIGURED");

    let campaignId: string;
    try {
      campaignId = await this.requireCampaignId();
    } catch (error) {
      const code = errorCode(error);
      return this.recordFailure(job, payload, code, isBudgetError(code) ? "budget_paused" : "failed");
    }

    let countedInputTokens: number;
    try {
      countedInputTokens = await this.countInputTokens(this.config.apiKey, this.config.model, this.config.prompt, input);
    } catch (error) {
      const code = errorCode(error);
      return this.recordFailure(job, payload, code, isBudgetError(code) ? "budget_paused" : "failed");
    }
    if (countedInputTokens > maximumCountedInputTokens) {
      return this.recordFailure(job, payload, "REQUIREMENT_PROPOSAL_INPUT_LIMIT_EXCEEDED");
    }

    let metered: MeteredRunResult;
    try {
      metered = await this.runner.run({
        campaignId,
        category: "model_inference",
        ownerId: job.owner_id,
        runId: payload.proposalRunId,
        requestId,
        model: this.config.model,
        instructions: this.config.prompt,
        input,
        countedInputTokens,
        maxOutputTokens: maximumOutputTokens,
        rate: this.config.rate,
      });
    } catch (error) {
      const code = errorCode(error);
      return this.recordFailure(job, payload, code, isBudgetError(code) ? "budget_paused" : "failed");
    }
    if (metered.state === "charge_uncertain") {
      return this.recordFailure(job, payload, "REQUIREMENT_PROPOSAL_CHARGE_UNCERTAIN", "budget_paused");
    }

    let candidates;
    try {
      candidates = parseRequirementProposals(metered.outputText, source.source_text);
    } catch (error) {
      return this.recordFailure(job, payload, errorCode(error), "failed", this.config.model, metered.responseId);
    }
    const recorded = await this.repository.recordPrivateRequirementProposal({
      jobId: job.id,
      fencingToken: job.fencing_token,
      ownerId: job.owner_id,
      proposalRunId: payload.proposalRunId,
      deletionGeneration: payload.deletionGeneration,
      state: "completed",
      model: this.config.model,
      responseId: metered.responseId,
      candidates,
    });
    return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "REQUIREMENT_PROPOSAL_FENCE_REJECTED" };
  }

  private async handleOwnerSuppliedCredential(
    job: ClaimedJob,
    payload: RequirementProposalPayload,
    source: PrivateRequirementProposalSource,
    credential: OwnerAiProviderCredential,
    input: string,
    requestId: string,
  ): Promise<{ state: "succeeded" | "failed" | "budget_paused" | "outcome_unknown"; errorCode?: string }> {
    if (this.byokSecret === null) return this.recordFailure(job, payload, "AI_CREDENTIAL_STORAGE_NOT_CONFIGURED");
    let response: { id: string; outputText: string };
    try {
      const apiKey = decryptApiKey(credential.key_ciphertext, this.byokSecret);
      response = await this.byokRunner.run(credential, apiKey, {
        input,
        instructions: this.byokPrompt,
        maxOutputTokens: maximumOutputTokens,
        requestId,
        runId: payload.proposalRunId,
      });
    } catch (error) {
      return this.recordFailure(job, payload, errorCode(error), "failed", `${credential.provider}/${credential.model}`);
    }
    let candidates;
    try {
      candidates = parseRequirementProposals(response.outputText, source.source_text);
    } catch (error) {
      return this.recordFailure(job, payload, errorCode(error), "failed", `${credential.provider}/${credential.model}`, response.id);
    }
    const recorded = await this.repository.recordPrivateRequirementProposal({
      jobId: job.id,
      fencingToken: job.fencing_token,
      ownerId: job.owner_id!,
      proposalRunId: payload.proposalRunId,
      deletionGeneration: payload.deletionGeneration,
      state: "completed",
      model: `${credential.provider}/${credential.model}`,
      responseId: response.id,
      candidates,
    });
    return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "REQUIREMENT_PROPOSAL_FENCE_REJECTED" };
  }

  private async requireCampaignId(): Promise<string> {
    const campaignId = await this.repository.activeBudgetCampaignId();
    if (!campaignId) throw new Error("BUDGET_CAMPAIGN_NOT_CONFIGURED");
    return campaignId;
  }

  private async recordFailure(
    job: ClaimedJob,
    payload: RequirementProposalPayload,
    code: string,
    terminalState: "failed" | "budget_paused" = "failed",
    model?: string,
    responseId?: string,
  ): Promise<{ state: "failed" | "budget_paused" | "outcome_unknown"; errorCode?: string }> {
    const recorded = await this.repository.recordPrivateRequirementProposal({
      jobId: job.id,
      fencingToken: job.fencing_token,
      ownerId: job.owner_id!,
      proposalRunId: payload.proposalRunId,
      deletionGeneration: payload.deletionGeneration,
      state: "failed",
      ...(model === undefined ? {} : { model }),
      ...(responseId === undefined ? {} : { responseId }),
      candidates: [],
      errorCode: code,
    });
    return recorded ? { state: terminalState, errorCode: code } : { state: "outcome_unknown", errorCode: "REQUIREMENT_PROPOSAL_FENCE_REJECTED" };
  }
}

/** Builds the live, metered handler only when its explicitly enabled job kind is configured. */
export async function createProposeRequirementsHandler(repository: WorkerRepository, budgets: BudgetGateway): Promise<ProposeRequirementsHandler> {
  const root = resolve(import.meta.dirname, "../../..");
  const prompt = await readFile(resolve(root, "prompts/requirement-extraction-v1.md"), "utf8");
  if (!prompt.trim()) throw new Error("REQUIREMENT_PROPOSAL_PROMPT_EMPTY");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.MODEL_SMALL?.trim();
  const ratePath = process.env.RATE_CARD_PATH?.trim();
  let config: RequirementProposalConfig | null = null;
  let runner: RequirementProposalRunner | null = null;
  if (apiKey && model && ratePath) {
    const rateCard = JSON.parse(await readFile(resolve(root, ratePath), "utf8")) as RateCard;
    const definition = rateCard.models[model];
    if (!definition) throw new Error(`RATE_CARD_MODEL_NOT_FOUND:${model}`);
    config = { apiKey, model, prompt, promptVersion, rate: parseRate(definition) };
    runner = new MeteredResponsesRunner(budgets, new OpenAIResponsesTransport(apiKey));
  }
  let byokSecret: string | null = null;
  try { byokSecret = resolveAiCredentialEncryptionSecret(); } catch { /* credential use reports a durable per-job error */ }
  return new ProposeRequirementsHandler(repository, config, runner, countOpenAIInputTokens, randomUUID, byokSecret, prompt);
}
