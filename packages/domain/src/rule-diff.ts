import type { RequirementDraft } from "@papertrail/contracts";

/**
 * A RuleDiff is deliberately based on requirement logical identities, not an
 * LLM's similarity score. Callers may use a model to propose lineage, but
 * split/merge/replacement lineage has to be passed explicitly and is checked
 * here before it can influence an impact evaluation.
 */
export type RuleDiffChangeKind = "added" | "removed" | "semantic_change" | "source_equivalent" | "review_change";
export type RuleDiffField = "kind" | "label" | "predicate" | "applicability" | "citation" | "effectiveFrom" | "ambiguityFlags";

export interface RuleLineage {
  kind: "split" | "merge" | "replacement";
  fromLogicalKeys: readonly string[];
  toLogicalKeys: readonly string[];
}

export interface RuleDiffChange {
  logicalKey: string;
  kind: RuleDiffChangeKind;
  changedFields: readonly RuleDiffField[];
  /** Changed predicates, applicability, rule kind, or effective date. */
  material: boolean;
  /** A changed ambiguity flag requires human review but cannot silently invalidate an approval. */
  requiresReview: boolean;
  lineage: readonly RuleLineage[];
}

export interface RuleDiffResult {
  changes: readonly RuleDiffChange[];
  materialLogicalKeys: readonly string[];
  reviewLogicalKeys: readonly string[];
  /** No stored requirement or provenance value changed. */
  isNoop: boolean;
  /** The revision changed only source/provenance or presentation-level data. */
  isSourceEquivalent: boolean;
}

const materialFields = new Set<RuleDiffField>(["kind", "predicate", "applicability", "effectiveFrom"]);
const reviewFields = new Set<RuleDiffField>(["ambiguityFlags"]);

function stableJson(value: unknown): string {
  if (value === undefined || value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function same(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function indexRequirements(requirements: readonly RequirementDraft[], side: "before" | "after"): Map<string, RequirementDraft> {
  const indexed = new Map<string, RequirementDraft>();
  for (const requirement of requirements) {
    if (indexed.has(requirement.logicalKey)) throw new Error(`RULE_DIFF_DUPLICATE_${side.toUpperCase()}_LOGICAL_KEY`);
    indexed.set(requirement.logicalKey, requirement);
  }
  return indexed;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIds);
}

function validateLineage(lineage: readonly RuleLineage[], before: ReadonlyMap<string, RequirementDraft>, after: ReadonlyMap<string, RequirementDraft>): void {
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  for (const item of lineage) {
    const from = sortedUnique(item.fromLogicalKeys);
    const to = sortedUnique(item.toLogicalKeys);
    const validShape =
      (item.kind === "split" && from.length === 1 && to.length > 1) ||
      (item.kind === "merge" && from.length > 1 && to.length === 1) ||
      (item.kind === "replacement" && from.length === 1 && to.length === 1);
    if (!validShape) throw new Error("RULE_DIFF_INVALID_LINEAGE_SHAPE");
    if (from.some((key) => !before.has(key)) || to.some((key) => !after.has(key))) throw new Error("RULE_DIFF_LINEAGE_UNKNOWN_KEY");
    if (from.some((key) => after.has(key)) || to.some((key) => before.has(key))) throw new Error("RULE_DIFF_LINEAGE_KEYS_MUST_BE_ADDED_OR_REMOVED");
    if (from.some((key) => usedFrom.has(key)) || to.some((key) => usedTo.has(key))) throw new Error("RULE_DIFF_LINEAGE_KEY_REUSED");
    from.forEach((key) => usedFrom.add(key));
    to.forEach((key) => usedTo.add(key));
  }
}

function lineagesFor(key: string, lineage: readonly RuleLineage[]): RuleLineage[] {
  return lineage.filter((item) => item.fromLogicalKeys.includes(key) || item.toLogicalKeys.includes(key));
}

function changedFields(before: RequirementDraft, after: RequirementDraft): RuleDiffField[] {
  const fields: RuleDiffField[] = [];
  if (before.kind !== after.kind) fields.push("kind");
  if (before.label !== after.label) fields.push("label");
  if (!same(before.predicate, after.predicate)) fields.push("predicate");
  if (!same(before.applicability, after.applicability)) fields.push("applicability");
  if (!same(before.citation, after.citation)) fields.push("citation");
  if (before.effectiveFrom !== after.effectiveFrom) fields.push("effectiveFrom");
  if (!same(before.ambiguityFlags, after.ambiguityFlags)) fields.push("ambiguityFlags");
  return fields;
}

/**
 * Diff one immutable rule set against another. Provenance-only and title-only
 * updates remain visible, but do not invalidate downstream approvals.
 */
export function diffRuleSets(input: {
  before: readonly RequirementDraft[];
  after: readonly RequirementDraft[];
  lineage?: readonly RuleLineage[] | undefined;
}): RuleDiffResult {
  const before = indexRequirements(input.before, "before");
  const after = indexRequirements(input.after, "after");
  const lineage = input.lineage ?? [];
  validateLineage(lineage, before, after);

  const logicalKeys = sortedUnique([...before.keys(), ...after.keys()]);
  const changes: RuleDiffChange[] = [];

  for (const logicalKey of logicalKeys) {
    const previous = before.get(logicalKey);
    const next = after.get(logicalKey);
    const relatedLineage = lineagesFor(logicalKey, lineage);
    if (previous === undefined && next !== undefined) {
      changes.push({ logicalKey, kind: "added", changedFields: [], material: true, requiresReview: true, lineage: relatedLineage });
      continue;
    }
    if (previous !== undefined && next === undefined) {
      changes.push({ logicalKey, kind: "removed", changedFields: [], material: true, requiresReview: true, lineage: relatedLineage });
      continue;
    }
    if (previous === undefined || next === undefined) continue;

    const fields = changedFields(previous, next);
    if (fields.length === 0) continue;
    const material = fields.some((field) => materialFields.has(field));
    const requiresReview = fields.some((field) => reviewFields.has(field));
    changes.push({
      logicalKey,
      kind: material ? "semantic_change" : requiresReview ? "review_change" : "source_equivalent",
      changedFields: fields,
      material,
      requiresReview,
      lineage: relatedLineage,
    });
  }

  const materialLogicalKeys = changes.filter((change) => change.material).map((change) => change.logicalKey);
  const reviewLogicalKeys = changes.filter((change) => change.requiresReview).map((change) => change.logicalKey);
  return {
    changes,
    materialLogicalKeys,
    reviewLogicalKeys,
    isNoop: changes.length === 0,
    isSourceEquivalent: changes.length > 0 && changes.every((change) => change.kind === "source_equivalent"),
  };
}

export type DependencyNodeType = "requirement" | "evidence_binding" | "field" | "artifact" | "changeset" | "approval" | "action";

export interface DependencyNode {
  /** Owner-scoped immutable node id (a version id where the entity is versioned). */
  id: string;
  type: DependencyNodeType;
  ownerId: string;
  applicationId: string;
}

/** Edges are directed from a prerequisite to the dependent work item. */
export interface DependencyEdge {
  fromId: string;
  toId: string;
  relation: string;
}

export interface DependencyImpact {
  affectedNodeIds: readonly string[];
  affectedArtifactIds: readonly string[];
  affectedChangesetIds: readonly string[];
  affectedApprovalIds: readonly string[];
  affectedActionIds: readonly string[];
}

function assertAcyclic(nodes: ReadonlyMap<string, DependencyNode>, edges: readonly DependencyEdge[]): void {
  const incoming = new Map<string, number>([...nodes.keys()].map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodes.has(edge.fromId) || !nodes.has(edge.toId)) throw new Error("RULE_DIFF_DEPENDENCY_UNKNOWN_NODE");
    if (edge.fromId === edge.toId) throw new Error("RULE_DIFF_DEPENDENCY_CYCLE");
    outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) ?? []), edge.toId]);
    incoming.set(edge.toId, (incoming.get(edge.toId) ?? 0) + 1);
  }
  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort(compareIds);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    visited += 1;
    for (const dependent of (outgoing.get(id) ?? []).sort(compareIds)) {
      const remaining = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
    ready.sort(compareIds);
  }
  if (visited !== nodes.size) throw new Error("RULE_DIFF_DEPENDENCY_CYCLE");
}

/**
 * Returns only descendants of changed nodes in one owner/application scope. An
 * unrelated branch is never re-evaluated, and malformed, cyclic, or mixed-scope
 * graphs are rejected up front. This pure function complements, rather than
 * replaces, repository authorization and RLS.
 */
export function traverseDependencyImpact(input: {
  ownerId: string;
  applicationId: string;
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
  changedNodeIds: readonly string[];
}): DependencyImpact {
  const nodes = new Map<string, DependencyNode>();
  for (const node of input.nodes) {
    if (!node.id || nodes.has(node.id)) throw new Error("RULE_DIFF_DEPENDENCY_INVALID_NODE");
    if (node.ownerId !== input.ownerId || node.applicationId !== input.applicationId) {
      throw new Error("RULE_DIFF_DEPENDENCY_SCOPE_VIOLATION");
    }
    nodes.set(node.id, node);
  }
  assertAcyclic(nodes, input.edges);

  const changed = sortedUnique(input.changedNodeIds);
  if (changed.some((id) => !nodes.has(id))) throw new Error("RULE_DIFF_DEPENDENCY_UNKNOWN_CHANGED_NODE");

  const outgoing = new Map<string, string[]>();
  for (const edge of input.edges) outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) ?? []), edge.toId]);

  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const dependent of (outgoing.get(id) ?? []).sort(compareIds)) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const affectedNodeIds = [...affected].sort(compareIds);
  const idsFor = (type: DependencyNodeType) => affectedNodeIds.filter((id) => nodes.get(id)?.type === type);
  return {
    affectedNodeIds,
    affectedArtifactIds: idsFor("artifact"),
    affectedChangesetIds: idsFor("changeset"),
    affectedApprovalIds: idsFor("approval"),
    affectedActionIds: idsFor("action"),
  };
}
