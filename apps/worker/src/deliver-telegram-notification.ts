import type { ClaimedJob, FinishableJobState, WorkerRepository } from "@papertrail/db";
import type { JobHandler } from "./durable-worker.js";

function deliveryId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { deliveryId?: unknown }).deliveryId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function telegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN_REQUIRED");
  return token;
}

function applicationUrl(path: string | null): string | null {
  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin || !path?.startsWith("/")) return null;
  try { return new URL(path, origin).toString(); } catch { return null; }
}

export class DeliverTelegramNotificationHandler implements JobHandler {
  readonly supportedKinds = ["deliver_telegram_notification"] as const;
  constructor(private readonly repository: WorkerRepository) {}

  async handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }> {
    const id = deliveryId(job.payload);
    if (id === null || job.owner_id === null) return { state: "failed", errorCode: "TELEGRAM_DELIVERY_INVALID_JOB" };
    const delivery = await this.repository.beginTelegramNotificationDelivery(job, id);
    if (delivery === null) return { state: "outcome_unknown", errorCode: "TELEGRAM_DELIVERY_FENCE_REJECTED" };
    const text = `A PaperTrail update may need your review.${applicationUrl(delivery.deep_link) ? `\n\nReview securely: ${applicationUrl(delivery.deep_link)}` : ""}`;
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegramToken()}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: delivery.telegram_chat_id.toString(), text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number } } | null;
      if (!response.ok || body?.ok !== true) {
        const recorded = await this.repository.recordTelegramNotificationDelivery(job, id, { state: "failed", errorCode: `TELEGRAM_HTTP_${response.status}` });
        return recorded ? { state: "failed", errorCode: `TELEGRAM_HTTP_${response.status}` } : { state: "outcome_unknown", errorCode: "TELEGRAM_DELIVERY_FENCE_REJECTED" };
      }
      const result = typeof body.result?.message_id === "number"
        ? { state: "sent" as const, providerMessageId: String(body.result.message_id) }
        : { state: "sent" as const };
      const recorded = await this.repository.recordTelegramNotificationDelivery(job, id, result);
      return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "TELEGRAM_DELIVERY_FENCE_REJECTED" };
    } catch {
      const recorded = await this.repository.recordTelegramNotificationDelivery(job, id, { state: "uncertain", errorCode: "TELEGRAM_NETWORK_OUTCOME_UNCERTAIN" });
      return recorded ? { state: "outcome_unknown", errorCode: "TELEGRAM_NETWORK_OUTCOME_UNCERTAIN" } : { state: "outcome_unknown", errorCode: "TELEGRAM_DELIVERY_FENCE_REJECTED" };
    }
  }
}
