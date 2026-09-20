import type { Evaluation, Predicate, PrimitiveValue } from "@papertrail/contracts";

type TruthValue = "true" | "false" | "unknown";
type ComparisonOp = "eq" | "neq" | "gte" | "gt" | "lte" | "lt";
type PathPredicate =
  | { op: "exists"; path: string }
  | { op: ComparisonOp; path: string; value: PrimitiveValue; unit?: string | undefined }
  | { op: "in"; path: string; values: PrimitiveValue[] };

export interface EvaluationContext {
  facts: Record<string, PrimitiveValue | undefined>;
  /** Paths whose relevant inventory has finished loading. Needed to distinguish absent from unknown. */
  completedPaths: ReadonlySet<string>;
  /** Server-side allowlist. Predicates for any other path are invalid for evaluation. */
  allowedPaths: ReadonlySet<string>;
}

export interface EvaluationResult {
  result: Evaluation;
  reason?: string;
}

function resolveFact(path: string, context: EvaluationContext): PrimitiveValue | undefined {
  if (!context.allowedPaths.has(path)) return undefined;
  const key = path.slice("facts.".length);
  return context.facts[key];
}

function comparison(left: PrimitiveValue, right: PrimitiveValue, op: ComparisonOp): TruthValue {
  if (typeof left !== typeof right) return "unknown";

  switch (op) {
    case "eq":
      return left === right ? "true" : "false";
    case "neq":
      return left !== right ? "true" : "false";
    case "gte":
    case "gt":
    case "lte":
    case "lt": {
      if (typeof left !== "number" && typeof left !== "string") return "unknown";
      if (typeof right !== "number" && typeof right !== "string") return "unknown";
      if (typeof left !== typeof right) return "unknown";
      if (op === "gte") return left >= right ? "true" : "false";
      if (op === "gt") return left > right ? "true" : "false";
      if (op === "lte") return left <= right ? "true" : "false";
      return left < right ? "true" : "false";
    }
  }
}

function hasPath(predicate: Predicate): predicate is PathPredicate {
  return "path" in predicate;
}

function evaluatePredicate(predicate: Predicate, context: EvaluationContext): TruthValue {
  if (predicate.op === "manual_review") return "unknown";

  if (predicate.op === "not") {
    const value = evaluatePredicate(predicate.arg, context);
    return value === "unknown" ? "unknown" : value === "true" ? "false" : "true";
  }

  if (predicate.op === "all" || predicate.op === "any") {
    const values = predicate.args.map((item) => evaluatePredicate(item, context));
    if (predicate.op === "all") {
      if (values.includes("false")) return "false";
      return values.every((item) => item === "true") ? "true" : "unknown";
    }
    if (values.includes("true")) return "true";
    return values.every((item) => item === "false") ? "false" : "unknown";
  }

  if (!hasPath(predicate)) return "unknown";
  if (!context.allowedPaths.has(predicate.path)) return "unknown";
  const left = resolveFact(predicate.path, context);

  if (predicate.op === "exists") {
    if (left !== undefined) return "true";
    return context.completedPaths.has(predicate.path) ? "false" : "unknown";
  }

  if (left === undefined) return "unknown";
  if (predicate.op === "in") return predicate.values.includes(left) ? "true" : "false";
  return comparison(left, predicate.value, predicate.op);
}

export function evaluateRequirement(
  requirement: Pick<import("@papertrail/contracts").RequirementDraft, "predicate" | "applicability">,
  context: EvaluationContext,
): EvaluationResult {
  const applicability = evaluatePredicate(requirement.applicability, context);
  if (applicability === "false") return { result: "not_applicable" };
  if (applicability === "unknown") return { result: "unknown", reason: "Applicability needs more confirmed facts." };

  const result = evaluatePredicate(requirement.predicate, context);
  if (result === "true") return { result: "pass" };
  if (result === "false") return { result: "fail" };
  return { result: "unknown", reason: "The evidence or rule needs review." };
}
