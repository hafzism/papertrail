import { describe, expect, it } from "vitest";
import type { RequirementDraft } from "@papertrail/contracts";
import { diffRuleSets, traverseDependencyImpact } from "../src/rule-diff.js";

const sourceHash = "a".repeat(64);
const snapshotId = "00000000-0000-4000-8000-000000000001";

function requirement(overrides: Partial<RequirementDraft> = {}): RequirementDraft {
  return {
    logicalKey: "income-certificate-freshness",
    kind: "document",
    label: "Income certificate issue date",
    predicate: { op: "gte", path: "facts.certificate_issue_date", value: "2026-04-01" },
    applicability: { op: "exists", path: "facts.applicant_type" },
    citation: { snapshotId, excerpt: "Certificate must be issued after 1 April 2026.", sourceHash },
    effectiveFrom: "2026-04-01",
    ambiguityFlags: [],
    ...overrides,
  };
}

describe("diffRuleSets", () => {
  it("treats cited-source or title-only edits as visible but non-material", () => {
    const before = requirement();
    const after = requirement({
      label: "Certificate issue date",
      citation: { ...before.citation, snapshotId: "00000000-0000-4000-8000-000000000002", sourceHash: "b".repeat(64) },
    });

    expect(diffRuleSets({ before: [before], after: [after] })).toEqual({
      changes: [
        {
          logicalKey: before.logicalKey,
          kind: "source_equivalent",
          changedFields: ["label", "citation"],
          material: false,
          requiresReview: false,
          lineage: [],
        },
      ],
      materialLogicalKeys: [],
      reviewLogicalKeys: [],
      isNoop: false,
      isSourceEquivalent: true,
    });
  });

  it("marks changed predicates and effective scope as material", () => {
    const before = requirement();
    const after = requirement({
      predicate: { op: "gte", path: "facts.certificate_issue_date", value: "2026-06-01" },
      effectiveFrom: "2026-06-01",
    });

    const result = diffRuleSets({ before: [before], after: [after] });
    expect(result.changes[0]).toMatchObject({
      kind: "semantic_change",
      changedFields: ["predicate", "effectiveFrom"],
      material: true,
    });
    expect(result.materialLogicalKeys).toEqual([before.logicalKey]);
  });

  it("keeps changed ambiguity as human review without an invented approval invalidation", () => {
    const before = requirement();
    const after = requirement({ ambiguityFlags: ["The source does not say whether renewals are included."] });
    const result = diffRuleSets({ before: [before], after: [after] });

    expect(result.changes[0]).toMatchObject({ kind: "review_change", material: false, requiresReview: true });
    expect(result.reviewLogicalKeys).toEqual([before.logicalKey]);
  });

  it("requires explicit, well-shaped lineage for splits and never implicitly matches added rules", () => {
    const before = requirement({ logicalKey: "income-certificate" });
    const after = [
      requirement({ logicalKey: "income-certificate-date" }),
      requirement({ logicalKey: "income-certificate-issuer" }),
    ];
    const lineage = [{ kind: "split" as const, fromLogicalKeys: [before.logicalKey], toLogicalKeys: after.map((item) => item.logicalKey) }];
    const result = diffRuleSets({ before: [before], after, lineage });

    expect(result.changes.map((change) => [change.logicalKey, change.kind])).toEqual([
      ["income-certificate", "removed"],
      ["income-certificate-date", "added"],
      ["income-certificate-issuer", "added"],
    ]);
    expect(result.changes.every((change) => change.lineage.length === 1)).toBe(true);
    expect(() => diffRuleSets({ before: [before], after, lineage: [{ kind: "split", fromLogicalKeys: [before.logicalKey], toLogicalKeys: [after[0]!.logicalKey] }] })).toThrow("RULE_DIFF_INVALID_LINEAGE_SHAPE");
  });

  it("is deterministic across list order and rejects duplicate logical identities", () => {
    const first = requirement();
    const second = requirement({ logicalKey: "photo" });
    expect(diffRuleSets({ before: [first, second], after: [second, first] })).toMatchObject({ isNoop: true, changes: [] });
    expect(() => diffRuleSets({ before: [first, first], after: [] })).toThrow("RULE_DIFF_DUPLICATE_BEFORE_LOGICAL_KEY");
  });

  it("normalizes omitted optional predicate fields before comparing semantics", () => {
    const before = requirement({ predicate: { op: "eq", path: "facts.applicant_type", value: "student" } });
    const after = requirement({ predicate: { op: "eq", path: "facts.applicant_type", value: "student", unit: undefined } });
    expect(diffRuleSets({ before: [before], after: [after] })).toMatchObject({ isNoop: true, changes: [] });
  });
});

describe("traverseDependencyImpact", () => {
  const ownerId = "00000000-0000-4000-8000-000000000010";
  const applicationId = "00000000-0000-4000-8000-000000000020";
  const nodes = [
    { id: "rule", type: "requirement" as const, ownerId, applicationId },
    { id: "binding", type: "evidence_binding" as const, ownerId, applicationId },
    { id: "packet", type: "artifact" as const, ownerId, applicationId },
    { id: "approval", type: "approval" as const, ownerId, applicationId },
    { id: "submit", type: "action" as const, ownerId, applicationId },
    { id: "unrelated-artifact", type: "artifact" as const, ownerId, applicationId },
  ];
  const edges = [
    { fromId: "rule", toId: "binding", relation: "evaluates" },
    { fromId: "binding", toId: "packet", relation: "renders" },
    { fromId: "packet", toId: "approval", relation: "prerequisite" },
    { fromId: "approval", toId: "submit", relation: "authorizes" },
  ];

  it("reaches only the dependent branch in a deterministic order", () => {
    expect(traverseDependencyImpact({ ownerId, applicationId, nodes, edges, changedNodeIds: ["rule"] })).toEqual({
      affectedNodeIds: ["approval", "binding", "packet", "rule", "submit"],
      affectedArtifactIds: ["packet"],
      affectedChangesetIds: [],
      affectedApprovalIds: ["approval"],
      affectedActionIds: ["submit"],
    });
  });

  it("rejects malformed graphs rather than traversing an unsafe partial dependency set", () => {
    expect(() => traverseDependencyImpact({ ownerId, applicationId, nodes, edges: [...edges, { fromId: "submit", toId: "rule", relation: "cycle" }], changedNodeIds: ["rule"] })).toThrow("RULE_DIFF_DEPENDENCY_CYCLE");
    expect(() => traverseDependencyImpact({ ownerId, applicationId, nodes, edges, changedNodeIds: ["not-a-node"] })).toThrow("RULE_DIFF_DEPENDENCY_UNKNOWN_CHANGED_NODE");
    expect(() => traverseDependencyImpact({
      ownerId,
      applicationId,
      nodes: [...nodes, { id: "other-owner", type: "artifact", ownerId: "00000000-0000-4000-8000-000000000099", applicationId }],
      edges,
      changedNodeIds: ["rule"],
    })).toThrow("RULE_DIFF_DEPENDENCY_SCOPE_VIOLATION");
  });
});
