import { describe, expect, it } from "vitest";
import { serializePacketManifest, type PacketManifestInput } from "../src/artifact-manifest.js";

const applicationId = "10000000-0000-4000-8000-0000000000a1";
const documentId = "20000000-0000-4000-8000-0000000000a1";
const documentVersionId = "30000000-0000-4000-8000-0000000000a1";
const requirementId = "40000000-0000-4000-8000-0000000000a1";
const bindingId = "50000000-0000-4000-8000-0000000000a1";

function manifest(): PacketManifestInput {
  return {
    manifestVersion: "packet-manifest-v1",
    submissionReady: false,
    application: { id: applicationId, title: "Scholarship application", materialVersion: 0 },
    documents: [{
      id: documentVersionId,
      documentId,
      filename: "certificate.pdf",
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      byteSize: 123,
      pageCount: 1,
    }],
    requirements: [{
      id: requirementId,
      logicalKey: "application.certificate",
      kind: "document",
      label: "Certificate", 
      citationExcerpt: "Attach the certificate.",
      citationSourceHash: "b".repeat(64),
      reviewState: "unresolved",
    }],
    bindings: [{ id: bindingId, requirementId, documentVersionId, state: "confirmed" }],
  };
}

describe("serializePacketManifest", () => {
  it("creates deterministic, review-only JSON from owner-scoped inputs", () => {
    const first = serializePacketManifest(manifest());
    const second = serializePacketManifest(manifest());
    expect(first).toBe(second);
    expect(JSON.parse(first)).toMatchObject({
      manifestVersion: "packet-manifest-v1",
      submissionReady: false,
      application: { id: applicationId },
    });
  });

  it("rejects an attempt to represent a manifest as a submission-ready packet", () => {
    expect(() => serializePacketManifest({ ...manifest(), submissionReady: true } as never)).toThrow("PACKET_MANIFEST_VERSION_OR_READINESS_INVALID");
  });

  it("rejects unsorted or duplicated immutable inputs", () => {
    const input = manifest();
    const unsorted = {
      ...input,
      documents: [
      ...input.documents,
      { ...input.documents[0]!, id: "30000000-0000-4000-8000-0000000000a0" },
      ],
    };
    expect(() => serializePacketManifest(unsorted)).toThrow("PACKET_MANIFEST_DOCUMENTS_ORDER_INVALID");
  });
});
