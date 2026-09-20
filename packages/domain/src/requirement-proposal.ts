export const requirementKinds = ["document", "field", "eligibility", "deadline", "format", "fee", "declaration"] as const;
export type RequirementKind = (typeof requirementKinds)[number];

export interface RequirementProposal {
  logicalKey: string;
  kind: RequirementKind;
  label: string;
  citationExcerpt: string;
  ambiguityFlags: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Model output is a suggestion; exact source citations are verified locally. */
export function parseRequirementProposals(output: string, sourceText: string): RequirementProposal[] {
  const trimmed = output.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(trimmed); } catch { throw new Error("REQUIREMENT_PROPOSAL_INVALID_JSON"); }
  if (!Array.isArray(value) || value.length > 20) throw new Error("REQUIREMENT_PROPOSAL_INVALID_ARRAY");
  return value.map((item) => {
    if (!isRecord(item) || Object.keys(item).some((key) => !["logicalKey", "kind", "label", "citationExcerpt", "ambiguityFlags"].includes(key))) throw new Error("REQUIREMENT_PROPOSAL_INVALID_OBJECT");
    const { logicalKey, kind, label, citationExcerpt, ambiguityFlags } = item;
    if (typeof logicalKey !== "string" || !/^[a-z][a-z0-9_.-]{0,119}$/.test(logicalKey)) throw new Error("REQUIREMENT_PROPOSAL_INVALID_KEY");
    if (typeof kind !== "string" || !requirementKinds.includes(kind as RequirementKind)) throw new Error("REQUIREMENT_PROPOSAL_INVALID_KIND");
    if (typeof label !== "string" || label.trim().length < 1 || label.length > 500) throw new Error("REQUIREMENT_PROPOSAL_INVALID_LABEL");
    if (typeof citationExcerpt !== "string" || citationExcerpt.trim().length < 1 || citationExcerpt.length > 4000 || !sourceText.includes(citationExcerpt)) throw new Error("REQUIREMENT_PROPOSAL_CITATION_NOT_IN_SOURCE");
    if (!isStringArray(ambiguityFlags) || ambiguityFlags.length > 20 || ambiguityFlags.some((flag) => flag.length < 1 || flag.length > 120)) throw new Error("REQUIREMENT_PROPOSAL_INVALID_AMBIGUITY_FLAGS");
    return { logicalKey, kind: kind as RequirementKind, label: label.trim(), citationExcerpt, ambiguityFlags };
  });
}
