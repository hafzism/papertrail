import { describe, expect, it } from "vitest";
import { requirementDraftSchema } from "@papertrail/contracts";
import { evaluateRequirement } from "../src/predicates.js";

const sourceHash = "a".repeat(64);
const applicationId = "00000000-0000-4000-8000-000000000001";
const base = {
  logicalKey: "income-certificate-freshness",
  kind: "document" as const,
  label: "Income certificate issue date",
  citation: { snapshotId: applicationId, excerpt: "Issued on or after 2026-04-01", sourceHash },
  effectiveFrom: "2026-04-01",
  ambiguityFlags: [],
};

const context = (facts: Record<string, string | number | boolean | undefined>, completed: string[] = Object.keys(facts)) => ({
  facts,
  completedPaths: new Set(completed),
  allowedPaths: new Set(["facts.certificate_issue_date", "facts.applicant_type", "facts.photo_uploaded"]),
});

describe("evaluateRequirement", () => {
  it("evaluates an applicable date-like string deterministically", () => {
    const requirement = requirementDraftSchema.parse({
      ...base,
      predicate: { op: "gte", path: "facts.certificate_issue_date", value: "2026-04-01" },
      applicability: { op: "eq", path: "facts.applicant_type", value: "student" },
    });

    expect(evaluateRequirement(requirement, context({ certificate_issue_date: "2026-06-01", applicant_type: "student" }))).toEqual({ result: "pass" });
    expect(evaluateRequirement(requirement, context({ certificate_issue_date: "2026-02-10", applicant_type: "student" }))).toEqual({ result: "fail" });
  });

  it("returns not_applicable before evaluating the requirement", () => {
    const requirement = requirementDraftSchema.parse({
      ...base,
      predicate: { op: "exists", path: "facts.photo_uploaded" },
      applicability: { op: "eq", path: "facts.applicant_type", value: "student" },
    });

    expect(evaluateRequirement(requirement, context({ applicant_type: "alumni" }))).toEqual({ result: "not_applicable" });
  });

  it("does not call an unconfirmed absence a failure", () => {
    const requirement = requirementDraftSchema.parse({
      ...base,
      predicate: { op: "exists", path: "facts.photo_uploaded" },
      applicability: { op: "eq", path: "facts.applicant_type", value: "student" },
    });

    expect(evaluateRequirement(requirement, context({ applicant_type: "student" }, ["facts.applicant_type"])).result).toBe("unknown");
    expect(evaluateRequirement(requirement, context({ applicant_type: "student" }, ["facts.applicant_type", "facts.photo_uploaded"]))).toEqual({ result: "fail" });
  });

  it("keeps unknown through boolean logic and applicability", () => {
    const requirement = requirementDraftSchema.parse({
      ...base,
      predicate: {
        op: "all",
        args: [
          { op: "eq", path: "facts.applicant_type", value: "student" },
          { op: "exists", path: "facts.photo_uploaded" },
        ],
      },
      applicability: { op: "exists", path: "facts.applicant_type" },
    });

    expect(evaluateRequirement(requirement, context({ applicant_type: "student" }, ["facts.applicant_type"])).result).toBe("unknown");
    expect(evaluateRequirement(requirement, context({}, [])).result).toBe("unknown");
  });

  it("rejects empty boolean predicates and unallowlisted paths at validation", () => {
    expect(() =>
      requirementDraftSchema.parse({ ...base, predicate: { op: "all", args: [] }, applicability: { op: "exists", path: "facts.applicant_type" } }),
    ).toThrow();
    expect(() =>
      requirementDraftSchema.parse({ ...base, predicate: { op: "exists", path: "owner_id" }, applicability: { op: "exists", path: "facts.applicant_type" } }),
    ).toThrow();
  });
});

