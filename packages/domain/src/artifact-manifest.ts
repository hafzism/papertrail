/**
 * The first W3 deliverable is deliberately a reviewable manifest, not an assertion
 * that a packet can be submitted. The worker supplies all owner-scoped values and
 * this module makes the byte representation stable for integrity hashing.
 */
export interface PacketManifestDocument {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  pageCount: number | null;
}

export interface PacketManifestRequirement {
  id: string;
  logicalKey: string;
  kind: string;
  label: string;
  citationExcerpt: string;
  citationSourceHash: string | null;
  reviewState: string;
}

export interface PacketManifestBinding {
  id: string;
  requirementId: string;
  documentVersionId: string;
  state: string;
}

export interface PacketManifestInput {
  manifestVersion: "packet-manifest-v1";
  submissionReady: false;
  application: {
    id: string;
    title: string;
    materialVersion: number;
  };
  documents: readonly PacketManifestDocument[];
  requirements: readonly PacketManifestRequirement[];
  bindings: readonly PacketManifestBinding[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function assertArrayOrder<T extends { id: string }>(values: readonly T[], name: string): void {
  const ids = new Set<string>();
  let previous = "";
  for (const value of values) {
    if (!/^[0-9a-f-]{36}$/i.test(value.id)) throw new Error(`PACKET_MANIFEST_INVALID_${name.toUpperCase()}_ID`);
    if (ids.has(value.id) || (previous && value.id.localeCompare(previous) < 0)) {
      throw new Error(`PACKET_MANIFEST_${name.toUpperCase()}_ORDER_INVALID`);
    }
    ids.add(value.id);
    previous = value.id;
  }
}

/**
 * Produces canonical JSON for the generated private object. Callers hash the returned
 * UTF-8 bytes before upload. The explicit false prevents any UI from mistaking a
 * manifest-only artifact for a filled or externally ready packet.
 */
export function serializePacketManifest(input: PacketManifestInput): string {
  if (input.manifestVersion !== "packet-manifest-v1" || input.submissionReady !== false) {
    throw new Error("PACKET_MANIFEST_VERSION_OR_READINESS_INVALID");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.application.id) || input.application.title.trim().length === 0) {
    throw new Error("PACKET_MANIFEST_APPLICATION_INVALID");
  }
  if (!Number.isSafeInteger(input.application.materialVersion) || input.application.materialVersion < 0) {
    throw new Error("PACKET_MANIFEST_APPLICATION_VERSION_INVALID");
  }
  assertArrayOrder(input.documents, "documents");
  assertArrayOrder(input.requirements, "requirements");
  assertArrayOrder(input.bindings, "bindings");
  for (const document of input.documents) {
    if (!/^[0-9a-f-]{36}$/i.test(document.documentId) || !/^[A-Fa-f0-9]{64}$/.test(document.sha256)) {
      throw new Error("PACKET_MANIFEST_DOCUMENT_INVALID");
    }
    if (!Number.isSafeInteger(document.byteSize) || document.byteSize < 1) throw new Error("PACKET_MANIFEST_DOCUMENT_SIZE_INVALID");
  }
  for (const requirement of input.requirements) {
    if (requirement.label.trim().length === 0 || requirement.citationExcerpt.length === 0) {
      throw new Error("PACKET_MANIFEST_REQUIREMENT_INVALID");
    }
    if (requirement.citationSourceHash !== null && !/^[A-Fa-f0-9]{64}$/.test(requirement.citationSourceHash)) {
      throw new Error("PACKET_MANIFEST_CITATION_HASH_INVALID");
    }
  }
  for (const binding of input.bindings) {
    if (!/^[0-9a-f-]{36}$/i.test(binding.requirementId) || !/^[0-9a-f-]{36}$/i.test(binding.documentVersionId)) {
      throw new Error("PACKET_MANIFEST_BINDING_INVALID");
    }
  }
  return `${JSON.stringify(stableValue(input), null, 2)}\n`;
}
