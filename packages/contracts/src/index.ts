import { z } from "zod";

export const evaluationSchema = z.enum(["pass", "fail", "unknown", "not_applicable"]);
export type Evaluation = z.infer<typeof evaluationSchema>;

export const privateSourceStatusSchema = z.literal("unresolved");
export const privateTextSourceSchema = z.object({
  applicationId: z.uuid(),
  description: z.string().trim().min(1).max(12_000),
});
export type PrivateTextSource = z.infer<typeof privateTextSourceSchema>;

export const primitiveValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export type PrimitiveValue = z.infer<typeof primitiveValueSchema>;

const predicatePathSchema = z
  .string()
  .regex(/^facts\.[a-z][a-z0-9_.-]*$/, "Predicate paths must be allowlisted fact paths.");

const predicateBaseSchema = z.object({
  op: z.string(),
});

export type Predicate =
  | { op: "all" | "any"; args: Predicate[] }
  | { op: "not"; arg: Predicate }
  | { op: "exists"; path: string }
  | {
      op: "eq" | "neq" | "gte" | "gt" | "lte" | "lt";
      path: string;
      value: PrimitiveValue;
      unit?: string | undefined;
    }
  | { op: "in"; path: string; values: PrimitiveValue[] }
  | { op: "manual_review"; reason: string };

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.enum(["all", "any"]),
      args: z.array(predicateSchema).min(1),
    }),
    z.object({ op: z.literal("not"), arg: predicateSchema }),
    z.object({ op: z.literal("exists"), path: predicatePathSchema }),
    z.object({
      op: z.enum(["eq", "neq", "gte", "gt", "lte", "lt"]),
      path: predicatePathSchema,
      value: primitiveValueSchema,
      unit: z.string().min(1).max(32).optional(),
    }),
    z.object({
      op: z.literal("in"),
      path: predicatePathSchema,
      values: z.array(primitiveValueSchema).min(1),
    }),
    z.object({ op: z.literal("manual_review"), reason: z.string().min(1).max(500) }),
  ]),
);

export const citationSchema = z.object({
  snapshotId: z.uuid(),
  page: z.number().int().positive().optional(),
  excerpt: z.string().min(1).max(4_000),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const requirementDraftSchema = z.object({
  logicalKey: z.string().min(1).max(120),
  kind: z.enum(["document", "field", "eligibility", "deadline", "format", "fee", "declaration"]),
  label: z.string().min(1).max(500),
  predicate: predicateSchema,
  applicability: predicateSchema,
  citation: citationSchema,
  effectiveFrom: z.iso.date().nullable(),
  ambiguityFlags: z.array(z.string().min(1).max(120)).max(20),
});
export type RequirementDraft = z.infer<typeof requirementDraftSchema>;

export const dependencyReferenceSchema = z.object({
  type: z.string().min(1).max(80),
  id: z.uuid(),
  version: z.string().min(1).max(128),
  hash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const changesetActionSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["disclose_fields", "upload_attachment", "save_draft", "submit", "send_institution_message"]),
  dependsOn: z.array(z.string().min(1).max(120)).max(20),
  fieldValues: z.record(z.string().min(1).max(120), z.string().max(10_000)).optional(),
  attachmentVersions: z
    .array(z.object({ id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/i), targetSlot: z.string().min(1).max(200) }))
    .max(20)
    .optional(),
  message: z
    .object({ recipient: z.string().min(1).max(320), subject: z.string().max(500), body: z.string().max(20_000) })
    .optional(),
  declarations: z
    .array(z.object({ text: z.string().min(1).max(10_000), userAttestationRequired: z.boolean() }))
    .max(20)
    .optional(),
  expectedObservation: z.string().min(1).max(2_000),
  reversible: z.boolean(),
});

export const changesetPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  applicationId: z.uuid(),
  destination: z.object({
    origin: z.url().refine((value) => new URL(value).protocol === "https:", "Destination must use HTTPS."),
    path: z.string().startsWith("/"),
    accountLabel: z.string().max(200).nullable(),
  }),
  actions: z.array(changesetActionSchema).min(1).max(50),
  prerequisites: z.array(dependencyReferenceSchema).max(500),
  applicableRuleSetHash: z.string().regex(/^[a-f0-9]{64}$/i),
  portalSchemaHash: z.string().regex(/^[a-f0-9]{64}$/i),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ChangesetPayload = z.infer<typeof changesetPayloadSchema>;

export const jobKindSchema = z.enum([
  "extract_document",
  "capture_public_source",
  "extract_notice",
  "monitor_source",
  "prepare_notice_diff",
  "fanout_revision",
  "detect_activity_candidate",
  "evaluate_activity_notice",
  "evaluate_impact",
  "prepare_artifact",
  "prepare_packet_manifest",
  "inspect_acroform",
  "execute_changeset",
  "deliver_notification",
  "deadline_scan",
  "expiry_scan",
  "cleanup",
  "account_export",
  "account_delete",
]);

export const activityConfirmationStateSchema = z.enum(["candidate", "owner_confirmed", "evidence_supported"]);
export const activityTrackingStateSchema = z.enum(["active", "paused", "ended"]);
export const followupActionStateSchema = z.enum([
  "needs_clarification",
  "available",
  "preparing",
  "awaiting_review",
  "submitted",
  "completed",
  "dismissed",
  "expired",
  "not_applicable",
]);
export type ActivityConfirmationState = z.infer<typeof activityConfirmationStateSchema>;
export type ActivityTrackingState = z.infer<typeof activityTrackingStateSchema>;
export type FollowupActionState = z.infer<typeof followupActionStateSchema>;

export const activityScopeSchema = z.object({
  jurisdiction: z.string().min(1).max(120).optional(),
  cohort: z.string().min(1).max(120).optional(),
  actionPeriod: z.string().min(1).max(120).optional(),
  stage: z.string().min(1).max(120).optional(),
  externalStatus: z.string().min(1).max(120).optional(),
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/), primitiveValueSchema).default({}),
});
export type ActivityScope = z.infer<typeof activityScopeSchema>;

export const activityCandidateSchema = z.object({
  activityType: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  sourceKind: z.enum(["document_version", "submission_evidence", "owner_record"]),
  sourceVersionId: z.uuid().nullable(),
  supportedFacts: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/), primitiveValueSchema),
  scope: activityScopeSchema,
}).superRefine((value, context) => {
  if (value.sourceKind === "owner_record" && value.sourceVersionId !== null) {
    context.addIssue({ code: "custom", path: ["sourceVersionId"], message: "Owner records do not reference an evidence version." });
  }
  if (value.sourceKind !== "owner_record" && value.sourceVersionId === null) {
    context.addIssue({ code: "custom", path: ["sourceVersionId"], message: "Evidence-derived candidates require an evidence version." });
  }
});
export type ActivityCandidate = z.infer<typeof activityCandidateSchema>;

export const activityMonitoringRequestSchema = z.object({
  activityId: z.uuid(),
  expectedRowVersion: z.number().int().nonnegative(),
  enabled: z.boolean(),
  sourceCoverageIds: z.array(z.uuid()).max(20),
});

export const followupActionIdentitySchema = z.object({
  activityId: z.uuid(),
  actionFamilyKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
  actionPeriod: z.string().min(1).max(120),
});
export type FollowupActionIdentity = z.infer<typeof followupActionIdentitySchema>;

export const JSON_SCHEMAS = {
  predicate: z.toJSONSchema(predicateSchema),
  privateTextSource: z.toJSONSchema(privateTextSourceSchema),
  requirementDraft: z.toJSONSchema(requirementDraftSchema),
  changesetPayload: z.toJSONSchema(changesetPayloadSchema),
  activityCandidate: z.toJSONSchema(activityCandidateSchema),
  followupActionIdentity: z.toJSONSchema(followupActionIdentitySchema),
} as const;
