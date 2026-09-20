import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, WorkerRepository } from "@papertrail/db";
import { serializePacketManifest, type PacketManifestInput } from "@papertrail/domain";
import type { JobHandler } from "./durable-worker.js";

const execFileAsync = promisify(execFile);

interface PacketManifestPayload {
  artifactRunId: string;
  applicationId: string;
  deletionGeneration: number;
}

function parsePayload(value: unknown): PacketManifestPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<PacketManifestPayload>;
  if (typeof payload.artifactRunId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.artifactRunId)) return null;
  if (typeof payload.applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.applicationId)) return null;
  if (!Number.isInteger(payload.deletionGeneration) || (payload.deletionGeneration ?? -1) < 0) return null;
  return {
    artifactRunId: payload.artifactRunId,
    applicationId: payload.applicationId,
    deletionGeneration: payload.deletionGeneration!,
  };
}

function errorCode(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "PACKET_MANIFEST_FAILED";
  return message.length <= 160 ? message : "PACKET_MANIFEST_FAILED";
}

async function buildPacketZip(storage: SupabaseClient, ownerId: string, applicationId: string, manifest: string, files: readonly { object_path: string; archive_name: string }[]): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "papertrail-packet-"));
  try {
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, manifest, "utf8");
    const archivePaths = ["manifest.json"];
    for (const file of files) {
      const archiveName = file.archive_name.replaceAll("\\", "/");
      if (!archiveName.startsWith("evidence/") || archiveName.includes("..")) throw new Error("PACKET_EXPORT_ARCHIVE_NAME_INVALID");
      const { data, error } = await storage.storage.from("private-documents").download(file.object_path);
      if (error || data === null) throw new Error("PACKET_EXPORT_DOCUMENT_READ_FAILED");
      const target = join(directory, archiveName);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await data.arrayBuffer()));
      archivePaths.push(archiveName);
    }
    await execFileAsync("/usr/bin/zip", ["-q", "packet-review-bundle.zip", ...archivePaths], { cwd: directory, maxBuffer: 2 * 1024 * 1024 });
    return new Uint8Array(await readFile(join(directory, "packet-review-bundle.zip")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A deterministic manifest plus confirmed-evidence review bundle; neither claims submission readiness. */
export class PreparePacketManifestHandler implements JobHandler {
  readonly supportedKinds = ["prepare_packet_manifest"] as const;

  constructor(
    private readonly repository: WorkerRepository,
    private readonly storage: SupabaseClient,
  ) {}

  async handle(job: ClaimedJob): Promise<{ state: "succeeded" | "failed" | "awaiting_user" | "outcome_unknown"; errorCode?: string }> {
    const payload = parsePayload(job.payload);
    if (job.owner_id === null || payload === null) return { state: "failed", errorCode: "PACKET_MANIFEST_INVALID_JOB_PAYLOAD" };
    const source = await this.repository.beginPrivatePacketManifest(job, payload.artifactRunId, payload.deletionGeneration);
    if (source === null) return { state: "outcome_unknown", errorCode: "PACKET_MANIFEST_FENCE_REJECTED" };
    if (source.state === "input_changed") return { state: "awaiting_user", errorCode: "PACKET_MANIFEST_INPUT_CHANGED" };
    if (source.input_version_vector === null || source.manifest_input === null) {
      return this.recordFailure(job, payload, "PACKET_MANIFEST_SOURCE_INVALID");
    }

    const objectPath = `packet-manifests/${payload.artifactRunId}/manifest.json`;
    const packetObjectPath = `packet-manifests/${payload.artifactRunId}/packet-review-bundle.zip`;
    try {
      const contents = serializePacketManifest(source.manifest_input as unknown as PacketManifestInput);
      const sha256 = createHash("sha256").update(contents, "utf8").digest("hex");
      const files = await this.repository.privatePacketExportFiles(job.owner_id, payload.applicationId);
      const packetContents = await buildPacketZip(this.storage, job.owner_id, payload.applicationId, contents, files);
      const packetSha256 = createHash("sha256").update(packetContents).digest("hex");
      const { error: uploadError } = await this.storage.storage.from("private-artifacts").upload(objectPath, contents, {
        contentType: "application/json; charset=utf-8",
        upsert: false,
      });
      if (uploadError) throw new Error("PACKET_MANIFEST_ARTIFACT_WRITE_FAILED");
      const { error: packetUploadError } = await this.storage.storage.from("private-artifacts").upload(packetObjectPath, packetContents, {
        contentType: "application/zip",
        upsert: false,
      });
      if (packetUploadError) throw new Error("PACKET_EXPORT_ARTIFACT_WRITE_FAILED");
      const recorded = await this.repository.recordPrivatePacketBundle({
        jobId: job.id,
        fencingToken: job.fencing_token,
        ownerId: job.owner_id,
        artifactRunId: payload.artifactRunId,
        deletionGeneration: payload.deletionGeneration,
        objectPath,
        sha256,
        inputVersionVector: source.input_version_vector,
        packetObjectPath,
        packetSha256,
      });
      if (recorded) return { state: "succeeded" };
      await this.storage.storage.from("private-artifacts").remove([objectPath, packetObjectPath]);
      return { state: "outcome_unknown", errorCode: "PACKET_MANIFEST_FENCE_REJECTED" };
    } catch (error) {
      return this.recordFailure(job, payload, errorCode(error));
    }
  }

  private async recordFailure(
    job: ClaimedJob,
    payload: PacketManifestPayload,
    code: string,
  ): Promise<{ state: "failed" | "outcome_unknown"; errorCode: string }> {
    const recorded = await this.repository.failPrivatePacketManifest(job, payload.artifactRunId, payload.deletionGeneration, code);
    return recorded ? { state: "failed", errorCode: code } : { state: "outcome_unknown", errorCode: "PACKET_MANIFEST_FENCE_REJECTED" };
  }
}

export { parsePayload as parsePacketManifestPayload };
