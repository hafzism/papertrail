import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, WorkerRepository } from "@papertrail/db";
import { inspectAcroForm } from "@papertrail/domain";
import type { JobHandler } from "./durable-worker.js";

interface Payload { inspectionId: string; documentVersionId: string; deletionGeneration: number; }
export function parseFormInspectionPayload(value: unknown): Payload | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Partial<Payload>;
  if (typeof item.inspectionId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.inspectionId)) return null;
  if (typeof item.documentVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.documentVersionId)) return null;
  if (!Number.isInteger(item.deletionGeneration) || (item.deletionGeneration ?? -1) < 0) return null;
  return item as Payload;
}

export class InspectAcroFormHandler implements JobHandler {
  readonly supportedKinds = ["inspect_acroform"] as const;
  constructor(private readonly repository: WorkerRepository, private readonly storage: SupabaseClient) {}
  async handle(job: ClaimedJob): Promise<{ state: "succeeded" | "failed" | "awaiting_user" | "outcome_unknown"; errorCode?: string }> {
    const payload = parseFormInspectionPayload(job.payload);
    if (!payload || !job.owner_id) return { state: "failed", errorCode: "FORM_INSPECTION_INVALID_JOB_PAYLOAD" };
    const source = await this.repository.beginDocumentFormInspection(job, payload.inspectionId, payload.deletionGeneration);
    if (!source) return { state: "outcome_unknown", errorCode: "FORM_INSPECTION_FENCE_REJECTED" };
    const { data, error } = await this.storage.storage.from("private-documents").download(source.object_path);
    if (error || !data) return this.record(job, payload, "failed", undefined, "FORM_INSPECTION_STORAGE_READ_FAILED", []);
    try {
      const inspection = await inspectAcroForm(new Uint8Array(await data.arrayBuffer()));
      const state = inspection.state === "fillable" ? "completed" : "needs_input";
      return this.record(job, payload, state, inspection.state, inspection.reason, inspection.fields);
    } catch (error) {
      const code = error instanceof Error ? error.message : "FORM_INSPECTION_FAILED";
      return this.record(job, payload, "failed", undefined, code, []);
    }
  }
  private async record(job: ClaimedJob, payload: Payload, state: "completed" | "needs_input" | "failed", formState: "fillable" | "assisted" | undefined, reasonCode: string | undefined, fields: readonly unknown[]) {
    const recorded = await this.repository.recordDocumentFormInspection({
      jobId: job.id,
      fencingToken: job.fencing_token,
      ownerId: job.owner_id!,
      inspectionId: payload.inspectionId,
      deletionGeneration: payload.deletionGeneration,
      state,
      ...(formState ? { formState } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      fields,
    });
    return recorded ? { state: state === "completed" ? "succeeded" as const : state === "needs_input" ? "awaiting_user" as const : "failed" as const, ...(reasonCode ? { errorCode: reasonCode } : {}) } : { state: "outcome_unknown" as const, errorCode: "FORM_INSPECTION_FENCE_REJECTED" };
  }
}
