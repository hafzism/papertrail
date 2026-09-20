import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, FinishableJobState, WorkerRepository } from "@papertrail/db";
import type { JobHandler } from "./durable-worker.js";
import { fetchPublicTextSource } from "./safe-public-fetch.js";

const maxExcerptCharacters = 8_000;

interface CapturePublicSourcePayload {
  privateSnapshotId: string;
  deletionGeneration: number;
}

function parsePayload(value: unknown): CapturePublicSourcePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<CapturePublicSourcePayload>;
  if (typeof payload.privateSnapshotId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.privateSnapshotId)) return null;
  if (!Number.isInteger(payload.deletionGeneration) || (payload.deletionGeneration ?? -1) < 0) return null;
  return { privateSnapshotId: payload.privateSnapshotId, deletionGeneration: payload.deletionGeneration! };
}

export class CapturePublicSourceHandler implements JobHandler {
  readonly supportedKinds = ["capture_public_source"] as const;

  constructor(private readonly repository: WorkerRepository, private readonly storage: SupabaseClient) {}

  async handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }> {
    const payload = parsePayload(job.payload);
    if (job.owner_id === null || payload === null) return { state: "failed", errorCode: "PUBLIC_SOURCE_INVALID_JOB_PAYLOAD" };
    const source = await this.repository.beginPublicSourceCapture(job, payload.privateSnapshotId, payload.deletionGeneration);
    if (source === null) return { state: "outcome_unknown", errorCode: "PUBLIC_SOURCE_CAPTURE_FENCE_REJECTED" };

    try {
      const captured = await fetchPublicTextSource(source.source_url);
      const textObjectPath = `source-captures/${payload.privateSnapshotId}/source.txt`;
      const { error: uploadError } = await this.storage.storage.from("private-artifacts").upload(textObjectPath, captured.text, {
        contentType: "text/plain; charset=utf-8",
        upsert: false,
      });
      if (uploadError) throw new Error("PUBLIC_SOURCE_ARTIFACT_WRITE_FAILED");
      const recorded = await this.repository.recordPublicSourceCapture({
        ownerId: job.owner_id,
        privateSnapshotId: payload.privateSnapshotId,
        jobId: job.id,
        fencingToken: job.fencing_token,
        deletionGeneration: payload.deletionGeneration,
        state: "captured",
        finalUrl: captured.finalUrl,
        sourceContentType: captured.contentType,
        contentSha256: captured.sha256,
        textObjectPath,
        textExcerpt: captured.text.slice(0, maxExcerptCharacters),
      });
      return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "PUBLIC_SOURCE_CAPTURE_FENCE_REJECTED" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "PUBLIC_SOURCE_CAPTURE_FAILED";
      const needsReview = code.startsWith("PUBLIC_SOURCE_") && code !== "PUBLIC_SOURCE_ARTIFACT_WRITE_FAILED";
      const recorded = await this.repository.recordPublicSourceCapture({
        ownerId: job.owner_id,
        privateSnapshotId: payload.privateSnapshotId,
        jobId: job.id,
        fencingToken: job.fencing_token,
        deletionGeneration: payload.deletionGeneration,
        state: needsReview ? "needs_review" : "failed",
        errorCode: code,
      });
      if (!recorded) return { state: "outcome_unknown", errorCode: "PUBLIC_SOURCE_CAPTURE_FENCE_REJECTED" };
      return needsReview ? { state: "awaiting_user", errorCode: code } : { state: "failed", errorCode: code };
    }
  }
}
