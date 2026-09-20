import { assertUsageIsCountable, calculateUsageNano, reserveWorstCaseNano, type ModelRate, type TokenUsage } from "./rates.js";

export interface ReservationInput {
  campaignId: string;
  category: "model_inference" | "integration_smoke";
  ownerId: string;
  runId: string;
  provider: "openai";
  amountNano: bigint;
  providerRequestId: string;
}

export interface BudgetGateway {
  reserve(input: ReservationInput): Promise<{ reservationId: string }>;
  settle(input: { reservationId: string; actualNano: bigint; usage: TokenUsage }): Promise<void>;
  markChargeUncertain(reservationId: string): Promise<void>;
}

export interface ResponsesTransport {
  create(request: { model: string; input: unknown; instructions: string; maxOutputTokens: number; metadata: Record<string, string> }): Promise<{
    id: string;
    outputText: string;
    usage?: TokenUsage;
  }>;
}

export interface MeteredRequest {
  campaignId: string;
  category: "model_inference" | "integration_smoke";
  ownerId: string;
  runId: string;
  requestId: string;
  model: string;
  instructions: string;
  input: unknown;
  /** Must come from a provider-supported counter; character-count estimates are forbidden. */
  countedInputTokens: number;
  maxOutputTokens: number;
  rate: ModelRate;
}

export type MeteredRunResult =
  | { state: "completed"; responseId: string; outputText: string; settledNano: bigint }
  | { state: "charge_uncertain"; reservationId: string; reason: "provider_error" | "usage_unavailable" | "usage_invalid" };

/**
 * One bounded, non-streaming Responses call. It intentionally has no retry loop:
 * a failed or unmetered provider response keeps its reservation and needs reconciliation.
 */
export class MeteredResponsesRunner {
  constructor(
    private readonly budgets: BudgetGateway,
    private readonly transport: ResponsesTransport,
  ) {}

  async run(request: MeteredRequest): Promise<MeteredRunResult> {
    const reservedNano = reserveWorstCaseNano(request.countedInputTokens, request.maxOutputTokens, request.rate);
    const { reservationId } = await this.budgets.reserve({
      campaignId: request.campaignId,
      category: request.category,
      ownerId: request.ownerId,
      runId: request.runId,
      provider: "openai",
      amountNano: reservedNano,
      providerRequestId: request.requestId,
    });

    let response: Awaited<ReturnType<ResponsesTransport["create"]>>;
    try {
      response = await this.transport.create({
        model: request.model,
        input: request.input,
        instructions: request.instructions,
        maxOutputTokens: request.maxOutputTokens,
        metadata: { papertrail_request_id: request.requestId, papertrail_run_id: request.runId },
      });
    } catch {
      await this.budgets.markChargeUncertain(reservationId);
      return { state: "charge_uncertain", reservationId, reason: "provider_error" };
    }

    if (response.usage === undefined) {
      await this.budgets.markChargeUncertain(reservationId);
      return { state: "charge_uncertain", reservationId, reason: "usage_unavailable" };
    }

    try {
      assertUsageIsCountable(response.usage);
      const actualNano = calculateUsageNano(response.usage, request.rate);
      if (actualNano > reservedNano) throw new Error("Provider usage exceeds the approved reservation.");
      await this.budgets.settle({ reservationId, actualNano, usage: response.usage });
      return { state: "completed", responseId: response.id, outputText: response.outputText, settledNano: actualNano };
    } catch {
      await this.budgets.markChargeUncertain(reservationId);
      return { state: "charge_uncertain", reservationId, reason: "usage_invalid" };
    }
  }
}

