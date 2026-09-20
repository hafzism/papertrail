import { describe, expect, it, vi } from "vitest";
import type { ClaimedJob } from "@papertrail/db";
import { ProposeRequirementsHandler, type RequirementProposalConfig } from "../src/propose-requirements.js";

const job: ClaimedJob = {
  id: "00000000-0000-4000-8000-000000000021",
  kind: "propose_private_requirements",
  owner_id: "00000000-0000-4000-8000-0000000000a1",
  public_scope: null,
  payload: { proposalRunId: "00000000-0000-4000-8000-000000000023", deletionGeneration: 0 },
  fencing_token: 7n,
  lease_expires_at: new Date(),
};

const sourceText = "Applicants must upload a passport-size photograph before 30 June 2027.";
const config: RequirementProposalConfig = {
  apiKey: "test-key",
  model: "gpt-5.6-luna",
  prompt: "Return JSON only.",
  promptVersion: "requirement-proposal-v1",
  rate: { inputNanoPerToken: 200n, cachedInputNanoPerToken: 20n, cacheWriteNanoPerToken: 250n, outputNanoPerToken: 1200n },
};

function repository() {
  return {
    beginPrivateRequirementProposal: vi.fn().mockResolvedValue({ source_text: sourceText, source_content_sha256: "a".repeat(64), prompt_version: "requirement-proposal-v1" }),
    activeBudgetCampaignId: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000022"),
    recordPrivateRequirementProposal: vi.fn().mockResolvedValue(true),
  };
}

describe("ProposeRequirementsHandler", () => {
  it("counts the complete prompt, validates exact citations, and records only fenced proposals", async () => {
    const db = repository();
    const countInputTokens = vi.fn().mockResolvedValue(321);
    const runner = { run: vi.fn().mockResolvedValue({
      state: "completed",
      responseId: "resp_123",
      outputText: JSON.stringify([{
        logicalKey: "application.photograph",
        kind: "document",
        label: "Upload a passport-size photograph.",
        citationExcerpt: "Applicants must upload a passport-size photograph",
        ambiguityFlags: [],
      }]),
      settledNano: 200n,
    }) };
    const handler = new ProposeRequirementsHandler(db as never, config, runner, countInputTokens, () => "request-123");

    await expect(handler.handle(job)).resolves.toEqual({ state: "succeeded" });
    expect(countInputTokens).toHaveBeenCalledWith("test-key", config.model, config.prompt, expect.stringContaining(sourceText));
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "00000000-0000-4000-8000-000000000022",
      ownerId: job.owner_id,
      runId: "00000000-0000-4000-8000-000000000023",
      requestId: "request-123",
      countedInputTokens: 321,
      maxOutputTokens: 1500,
    }));
    expect(db.recordPrivateRequirementProposal).toHaveBeenCalledWith(expect.objectContaining({
      jobId: job.id,
      fencingToken: 7n,
      proposalRunId: "00000000-0000-4000-8000-000000000023",
      responseId: "resp_123",
      candidates: [expect.objectContaining({ logicalKey: "application.photograph" })],
    }));
  });

  it("pauses work after an uncertain provider charge and does not persist candidates", async () => {
    const db = repository();
    const runner = { run: vi.fn().mockResolvedValue({ state: "charge_uncertain", reservationId: "reserve-1", reason: "usage_unavailable" }) };
    const handler = new ProposeRequirementsHandler(db as never, config, runner, async () => 30);

    await expect(handler.handle(job)).resolves.toEqual({ state: "budget_paused", errorCode: "REQUIREMENT_PROPOSAL_CHARGE_UNCERTAIN" });
    expect(db.recordPrivateRequirementProposal).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", errorCode: "REQUIREMENT_PROPOSAL_CHARGE_UNCERTAIN", candidates: [] }));
  });

  it("rejects model text with a non-source citation after the metered call", async () => {
    const db = repository();
    const runner = { run: vi.fn().mockResolvedValue({
      state: "completed",
      responseId: "resp_124",
      outputText: JSON.stringify([{
        logicalKey: "application.deadline",
        kind: "deadline",
        label: "Apply by tomorrow.",
        citationExcerpt: "Apply by tomorrow.",
        ambiguityFlags: [],
      }]),
      settledNano: 200n,
    }) };
    const handler = new ProposeRequirementsHandler(db as never, config, runner, async () => 30);

    await expect(handler.handle(job)).resolves.toEqual({ state: "failed", errorCode: "REQUIREMENT_PROPOSAL_CITATION_NOT_IN_SOURCE" });
    expect(db.recordPrivateRequirementProposal).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", responseId: "resp_124", candidates: [] }));
  });
});
