import { describe, expect, it } from "vitest";
import { activityCandidateSchema } from "@papertrail/contracts";
import { canEnableActivityMonitoring, canPrepareLinkedApplication, classifyFollowupTrigger } from "../src/activities.js";

const identity = { activityId: "00000000-0000-4000-8000-000000000001", actionFamilyKey: "exam_registration", actionPeriod: "DEMO-2026" };

describe("generic activity follow-up guards", () => {
  it("does not convert a receipt candidate into active monitoring", () => {
    expect(canEnableActivityMonitoring({ confirmationState: "candidate", trackingState: "paused", requestedEnabled: true, explicitOptIn: true })).toBe(false);
    expect(canEnableActivityMonitoring({ confirmationState: "owner_confirmed", trackingState: "paused", requestedEnabled: true, explicitOptIn: false })).toBe(false);
    expect(canEnableActivityMonitoring({ confirmationState: "owner_confirmed", trackingState: "paused", requestedEnabled: true, explicitOptIn: true })).toBe(true);
  });

  it("distinguishes an action-opening notice from an expiry reminder", () => {
    expect(classifyFollowupTrigger({ kind: "verified_notice", noticeVersionId: "notice", actionIdentity: identity })).toBe("action");
    expect(classifyFollowupTrigger({ kind: "expiry_date", evidenceVersionId: "evidence", hasActionRule: false, actionIdentity: identity })).toBe("reminder_only");
  });

  it("creates only one linked application for an available opted-in action", () => {
    const eligible = { confirmationState: "evidence_supported" as const, trackingEnabled: true, actionState: "available" as const, linkedApplicationId: null };
    expect(canPrepareLinkedApplication(eligible)).toBe(true);
    expect(canPrepareLinkedApplication({ ...eligible, linkedApplicationId: "existing-application" })).toBe(false);
    expect(canPrepareLinkedApplication({ ...eligible, actionState: "needs_clarification" })).toBe(false);
  });

  it("requires provenance for evidence-derived candidates", () => {
    expect(() => activityCandidateSchema.parse({ activityType: "admission", title: "Candidate", sourceKind: "submission_evidence", sourceVersionId: null, supportedFacts: {}, scope: {} })).toThrow();
    expect(activityCandidateSchema.parse({ activityType: "renewal", title: "Owner record", sourceKind: "owner_record", sourceVersionId: null, supportedFacts: {}, scope: {} }).sourceKind).toBe("owner_record");
  });
});
