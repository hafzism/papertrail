import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, WorkerRepository } from "@papertrail/db";
import { fillAcroForm, verifyAcroFormValues, type AcroFormValue } from "@papertrail/domain";
import type { JobHandler } from "./durable-worker.js";

const run = promisify(execFile);

interface Payload {
  artifactRunId: string;
  applicationId: string;
  inspectionId: string;
  deletionGeneration: number;
}

export function parseAcroFormDerivativePayload(value: unknown): Payload | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Partial<Payload>;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (typeof item.artifactRunId !== "string" || !uuid.test(item.artifactRunId)) return null;
  if (typeof item.applicationId !== "string" || !uuid.test(item.applicationId)) return null;
  if (typeof item.inspectionId !== "string" || !uuid.test(item.inspectionId)) return null;
  if (!Number.isInteger(item.deletionGeneration) || (item.deletionGeneration ?? -1) < 0) return null;
  return item as Payload;
}

function asValues(fieldValues: Record<string, string | boolean> | null): AcroFormValue[] | null {
  if (fieldValues === null) return null;
  const values = Object.entries(fieldValues).map(([fieldName, value]) => ({ fieldName, value }));
  return values.length > 0 && values.every((value) => typeof value.value === "string" || typeof value.value === "boolean") ? values : null;
}

async function passesRenderCheck(bytes: Uint8Array): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "papertrail-form-review-"));
  const inputPath = join(directory, "filled.pdf");
  const outputPrefix = join(directory, "preview");
  try {
    await writeFile(inputPath, bytes, { mode: 0o600 });
    await run("pdftoppm", ["-f", "1", "-l", "1", "-png", inputPath, outputPrefix], { timeout: 30_000, maxBuffer: 50_000 });
    return true;
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 2 });
  }
}

function errorCode(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "ACROFORM_DERIVATIVE_FAILED";
  return message.length <= 160 ? message : "ACROFORM_DERIVATIVE_FAILED";
}

/** Produces a separate review-only PDF; it never changes the uploaded original. */
export class PrepareAcroFormDerivativeHandler implements JobHandler {
  readonly supportedKinds = ["prepare_filled_acroform"] as const;

  constructor(
    private readonly repository: WorkerRepository,
    private readonly storage: SupabaseClient,
    private readonly renderCheck: (bytes: Uint8Array) => Promise<boolean> = passesRenderCheck,
  ) {}

  async handle(job: ClaimedJob): Promise<{ state: "succeeded" | "failed" | "awaiting_user" | "outcome_unknown"; errorCode?: string }> {
    const payload = parseAcroFormDerivativePayload(job.payload);
    if (!payload || job.owner_id === null) return { state: "failed", errorCode: "ACROFORM_DERIVATIVE_INVALID_JOB_PAYLOAD" };
    const source = await this.repository.beginPrivateAcroFormDerivative(job, payload.artifactRunId, payload.deletionGeneration);
    if (!source) return { state: "outcome_unknown", errorCode: "ACROFORM_DERIVATIVE_FENCE_REJECTED" };
    if (source.state === "input_changed") return { state: "awaiting_user", errorCode: "ACROFORM_DERIVATIVE_INPUT_CHANGED" };
    const values = asValues(source.field_values);
    if (!source.object_path || !source.input_version_vector || !values) return this.fail(job, payload, "ACROFORM_DERIVATIVE_SOURCE_INVALID");
    const { data, error } = await this.storage.storage.from("private-documents").download(source.object_path);
    if (error || !data) return this.fail(job, payload, "ACROFORM_DERIVATIVE_STORAGE_READ_FAILED");
    try {
      const result = await fillAcroForm(new Uint8Array(await data.arrayBuffer()), values);
      if (result.state === "assisted") return this.fail(job, payload, result.reason);
      if (!await verifyAcroFormValues(result.bytes, values)) return this.fail(job, payload, "ACROFORM_DERIVATIVE_VALUE_VERIFICATION_FAILED");
      const renderCheckStatus = await this.renderCheck(result.bytes) ? "passed" as const : "failed" as const;
      if (renderCheckStatus === "failed") return this.fail(job, payload, "ACROFORM_DERIVATIVE_RENDER_CHECK_FAILED");
      const objectPath = `filled-acroforms/${payload.artifactRunId}/review-copy.pdf`;
      const { error: uploadError } = await this.storage.storage.from("private-artifacts").upload(objectPath, result.bytes, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (uploadError) throw new Error("ACROFORM_DERIVATIVE_ARTIFACT_WRITE_FAILED");
      const recorded = await this.repository.recordPrivateAcroFormDerivative({
        jobId: job.id, fencingToken: job.fencing_token, ownerId: job.owner_id, artifactRunId: payload.artifactRunId,
        deletionGeneration: payload.deletionGeneration, objectPath,
        sha256: createHash("sha256").update(result.bytes).digest("hex"),
        inputVersionVector: source.input_version_vector, renderCheckStatus,
      });
      if (recorded) return { state: "succeeded" };
      await this.storage.storage.from("private-artifacts").remove([objectPath]);
      return { state: "outcome_unknown", errorCode: "ACROFORM_DERIVATIVE_FENCE_REJECTED" };
    } catch (error) {
      return this.fail(job, payload, errorCode(error));
    }
  }

  private async fail(job: ClaimedJob, payload: Payload, code: string): Promise<{ state: "failed" | "outcome_unknown"; errorCode: string }> {
    const recorded = await this.repository.failPrivateAcroFormDerivative(job, payload.artifactRunId, payload.deletionGeneration, code);
    return recorded ? { state: "failed", errorCode: code } : { state: "outcome_unknown", errorCode: "ACROFORM_DERIVATIVE_FENCE_REJECTED" };
  }
}
