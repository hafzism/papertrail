import type { ClaimedJob, FinishableJobState, WorkerRepository } from "@papertrail/db";
import type { JobHandler } from "./durable-worker.js";
import { fetchPublicTextSource } from "./safe-public-fetch.js";

function sourceId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { sourceId?: unknown }).sourceId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export class MonitorPublishedSourceHandler implements JobHandler {
  readonly supportedKinds = ["monitor_published_source"] as const;
  constructor(private readonly repository: WorkerRepository) {}
  async handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }> {
    const id = sourceId(job.payload);
    if (job.owner_id !== null || id === null) return { state: "failed", errorCode: "PUBLISHED_SOURCE_INVALID_JOB_PAYLOAD" };
    const source = await this.repository.beginPublishedSourceCheck(job, id);
    if (source === null) return { state: "outcome_unknown", errorCode: "PUBLISHED_SOURCE_CHECK_FENCE_REJECTED" };
    try {
      const captured = await fetchPublicTextSource(source.source_url);
      const recorded = await this.repository.recordPublishedSourceCheck(job, id, { state: "success", finalUrl: captured.finalUrl, contentType: captured.contentType, contentSha256: captured.sha256 });
      return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "PUBLISHED_SOURCE_CHECK_FENCE_REJECTED" };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "PUBLISHED_SOURCE_CHECK_FAILED";
      const recorded = await this.repository.recordPublishedSourceCheck(job, id, { state: "failed", errorCode });
      return recorded ? { state: "failed", errorCode } : { state: "outcome_unknown", errorCode: "PUBLISHED_SOURCE_CHECK_FENCE_REJECTED" };
    }
  }
}
