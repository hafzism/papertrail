import type { ActivityConfirmationState, ActivityTrackingState, FollowupActionIdentity } from "@papertrail/contracts";

export type FollowupTrigger =
  | { kind: "verified_notice"; noticeVersionId: string; actionIdentity: FollowupActionIdentity }
  | { kind: "due_date" | "expiry_date" | "owner_reminder"; evidenceVersionId: string; hasActionRule: boolean; actionIdentity: FollowupActionIdentity };

/** Receipt detection is only a proposal; consent is not implied by confirmation. */
export function canEnableActivityMonitoring(input: {
  confirmationState: ActivityConfirmationState;
  trackingState: ActivityTrackingState;
  requestedEnabled: boolean;
  explicitOptIn: boolean;
}): boolean {
  if (!input.requestedEnabled) return true;
  if (input.trackingState === "ended") return false;
  return input.explicitOptIn && (input.confirmationState === "owner_confirmed" || input.confirmationState === "evidence_supported");
}

/** A date can remind the owner, but only trusted/owner-provided action rules can create an action. */
export function classifyFollowupTrigger(trigger: FollowupTrigger): "action" | "reminder_only" {
  if (trigger.kind === "verified_notice") return "action";
  return trigger.hasActionRule ? "action" : "reminder_only";
}

/** No second linked application may be created for an action that already has one. */
export function canPrepareLinkedApplication(input: {
  confirmationState: ActivityConfirmationState;
  trackingEnabled: boolean;
  actionState: "needs_clarification" | "available" | "preparing" | "awaiting_review" | "submitted" | "completed" | "dismissed" | "expired" | "not_applicable";
  linkedApplicationId: string | null;
}): boolean {
  return (
    (input.confirmationState === "owner_confirmed" || input.confirmationState === "evidence_supported") &&
    input.trackingEnabled &&
    input.actionState === "available" &&
    input.linkedApplicationId === null
  );
}

