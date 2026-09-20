import { describe, expect, it, vi } from "vitest";
import { PreparePacketManifestHandler, parsePacketManifestPayload } from "../src/prepare-packet-manifest.js";

const ownerId = "00000000-0000-4000-8000-0000000000a1";
const runId = "10000000-0000-4000-8000-0000000000a1";
const applicationId = "20000000-0000-4000-8000-0000000000a1";
const job = {
  id: "30000000-0000-4000-8000-0000000000a1",
  kind: "prepare_packet_manifest",
  owner_id: ownerId,
  public_scope: null,
  payload: { artifactRunId: runId, applicationId, deletionGeneration: 0 },
  fencing_token: 1n,
  lease_expires_at: new Date(),
};

const manifestInput = {
  manifestVersion: "packet-manifest-v1" as const,
  submissionReady: false as const,
  application: { id: applicationId, title: "Scholarship", materialVersion: 0 },
  documents: [],
  requirements: [],
  bindings: [],
};

function storage() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  return {
    storage: { storage: { from: vi.fn().mockReturnValue({ upload, remove }) } },
    upload,
    remove,
  };
}

describe("PreparePacketManifestHandler", () => {
  it("writes a deterministic review-only manifest and records its hash through the fenced repository", async () => {
    const repository = {
      beginPrivatePacketManifest: vi.fn().mockResolvedValue({
        state: "ready",
        input_version_vector: { application: { id: applicationId, materialVersion: 0 }, documents: [], requirements: [], bindings: [] },
        manifest_input: manifestInput,
      }),
      privatePacketExportFiles: vi.fn().mockResolvedValue([]),
      recordPrivatePacketBundle: vi.fn().mockResolvedValue(true),
    };
    const fakeStorage = storage();
    const handler = new PreparePacketManifestHandler(repository as never, fakeStorage.storage as never);

    await expect(handler.handle(job)).resolves.toEqual({ state: "succeeded" });
    expect(fakeStorage.upload).toHaveBeenCalledWith(
      `packet-manifests/${runId}/manifest.json`,
      expect.stringContaining('"submissionReady": false'),
      expect.objectContaining({ contentType: "application/json; charset=utf-8" }),
    );
    expect(fakeStorage.upload).toHaveBeenCalledWith(
      `packet-manifests/${runId}/packet-review-bundle.zip`,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "application/zip" }),
    );
    expect(repository.recordPrivatePacketBundle).toHaveBeenCalledWith(expect.objectContaining({
      artifactRunId: runId,
      ownerId,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      packetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("does not upload when inputs changed after the owner requested the manifest", async () => {
    const repository = { beginPrivatePacketManifest: vi.fn().mockResolvedValue({ state: "input_changed", input_version_vector: null, manifest_input: null }) };
    const fakeStorage = storage();
    const handler = new PreparePacketManifestHandler(repository as never, fakeStorage.storage as never);

    await expect(handler.handle(job)).resolves.toEqual({ state: "awaiting_user", errorCode: "PACKET_MANIFEST_INPUT_CHANGED" });
    expect(fakeStorage.upload).not.toHaveBeenCalled();
  });

  it("validates the strictly scoped job payload", () => {
    expect(parsePacketManifestPayload({ artifactRunId: runId, applicationId, deletionGeneration: 0 })).toEqual({ artifactRunId: runId, applicationId, deletionGeneration: 0 });
    expect(parsePacketManifestPayload({ artifactRunId: runId, applicationId, deletionGeneration: -1 })).toBeNull();
  });
});
