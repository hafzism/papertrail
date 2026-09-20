import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";
import { MeteredResponsesRunner, OpenAIResponsesTransport, type ModelRate } from "@papertrail/ai";
import { PostgresBudgetGateway, type SqlExecutor } from "@papertrail/db";

loadDotenv({ path: resolve(import.meta.dirname, "../../..", ".env"), quiet: true });

interface RateCard {
  models: Record<string, {
    inputNanoPerToken: number;
    cachedInputNanoPerToken: number;
    cacheWriteNanoPerToken: number;
    outputNanoPerToken: number;
  }>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the metered OpenAI smoke test.`);
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

async function countInputTokens(apiKey: string, model: string, instructions: string, input: string): Promise<number> {
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

async function main(): Promise<void> {
  const apiKey = requiredEnvironment("OPENAI_API_KEY");
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const model = requiredEnvironment("MODEL_SMALL");
  const ratePath = requiredEnvironment("RATE_CARD_PATH");
  const rateCard = JSON.parse(await readFile(resolve(import.meta.dirname, "../../..", ratePath), "utf8")) as RateCard;
  const rateDefinition = rateCard.models[model];
  if (!rateDefinition) throw new Error(`RATE_CARD_MODEL_NOT_FOUND:${model}`);
  const instructions = "This is a PaperTrail provider smoke test. Return exactly the requested fixed acknowledgement and no other text.";
  const input = "Return exactly: PAPERTRAIL_OPENAI_SMOKE_OK";
  const countedInputTokens = await countInputTokens(apiKey, model, instructions, input);
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 10 });
  const executor: SqlExecutor = {
    async unsafe<T extends readonly object[]>(query: string, parameters: readonly unknown[]): Promise<T> {
      return (await sql.unsafe(query, parameters as never[])) as unknown as T;
    },
  };
  try {
    const campaignRows = await executor.unsafe<Array<{ id: string }>>(
      "select id from public.budget_campaigns where name = 'papertrail-default' and state = 'active'",
      [],
    );
    const ownerRows = await executor.unsafe<Array<{ user_id: string }>>(
      "select user_id from public.profiles order by created_at asc limit 1",
      [],
    );
    const campaignId = campaignRows[0]?.id;
    const ownerId = ownerRows[0]?.user_id;
    if (!campaignId) throw new Error("BUDGET_CAMPAIGN_NOT_CONFIGURED");
    if (!ownerId) throw new Error("OPENAI_SMOKE_REQUIRES_AN_EXISTING_OWNER_PROFILE");
    const result = await new MeteredResponsesRunner(
      new PostgresBudgetGateway(executor),
      new OpenAIResponsesTransport(apiKey),
    ).run({
      campaignId,
      category: "integration_smoke",
      ownerId,
      runId: randomUUID(),
      requestId: randomUUID(),
      model,
      instructions,
      input,
      countedInputTokens,
      maxOutputTokens: 24,
      rate: parseRate(rateDefinition),
    });
    if (result.state !== "completed") throw new Error(`OPENAI_SMOKE_${result.reason.toUpperCase()}`);
    if (result.outputText.trim() !== "PAPERTRAIL_OPENAI_SMOKE_OK") throw new Error("OPENAI_SMOKE_UNEXPECTED_OUTPUT");
    console.info(JSON.stringify({ event: "openai.smoke_succeeded", responseId: result.responseId, settledNano: result.settledNano.toString() }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "openai.smoke_failed", errorCode: error instanceof Error ? error.message : "OPENAI_SMOKE_UNKNOWN" }));
  process.exitCode = 1;
});
