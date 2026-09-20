import { describe, expect, it } from "vitest";
import { parseRequirementProposals } from "../src/index.js";

const source = "Applicants must upload a passport-size photograph before 30 June 2027.";

describe("parseRequirementProposals", () => {
  it("accepts bounded atomic proposals with exact source citations", () => {
    expect(parseRequirementProposals(JSON.stringify([{
      logicalKey: "application.photograph", kind: "document", label: "Upload a passport-size photograph.",
      citationExcerpt: "Applicants must upload a passport-size photograph", ambiguityFlags: ["Photo dimensions are not stated."],
    }]), source)).toHaveLength(1);
  });

  it("rejects a citation that was not actually present in the source", () => {
    expect(() => parseRequirementProposals(JSON.stringify([{
      logicalKey: "application.deadline", kind: "deadline", label: "Apply by 1 July 2027.", citationExcerpt: "Apply by 1 July 2027.", ambiguityFlags: [],
    }]), source)).toThrow("REQUIREMENT_PROPOSAL_CITATION_NOT_IN_SOURCE");
  });
});
