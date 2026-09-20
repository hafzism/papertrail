export interface SqlExecutor {
  unsafe<T extends readonly object[]>(query: string, parameters: readonly unknown[]): Promise<T>;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  owner_id: string | null;
  public_scope: string | null;
  payload: unknown;
  fencing_token: bigint;
  lease_expires_at: Date;
}

export interface ExtractableDocument {
  object_path: string;
  mime_type: string;
  original_filename: string;
  byte_size: bigint;
}

export interface DocumentExtractionResult {
  ownerId: string;
  documentVersionId: string;
  jobId: string;
  fencingToken: bigint;
  deletionGeneration: number;
  extractorVersion: string;
  state: "completed" | "failed" | "needs_input";
  textObjectPath?: string;
  textExcerpt?: string;
  pageCount?: number;
  uncertaintyFlags: readonly string[];
  provenance: Readonly<Record<string, unknown>>;
}

export interface CapturablePublicSource {
  source_url: string;
}

export interface PublicSourceCaptureResult {
  ownerId: string;
  privateSnapshotId: string;
  jobId: string;
  fencingToken: bigint;
  deletionGeneration: number;
  state: "captured" | "needs_review" | "failed";
  finalUrl?: string;
  sourceContentType?: string;
  contentSha256?: string;
  textObjectPath?: string;
  textExcerpt?: string;
  errorCode?: string;
}

/** A single immutable private source selected by a fenced requirement-proposal run. */
export interface PrivateRequirementProposalSource {
  source_text: string;
  source_content_sha256: string;
  prompt_version: string;
}

export interface PrivateRequirementProposalResult {
  jobId: string;
  fencingToken: bigint;
  ownerId: string;
  proposalRunId: string;
  deletionGeneration: number;
  state: "completed" | "failed";
  model?: string;
  responseId?: string;
  candidates: readonly {
    logicalKey: string;
    kind: string;
    label: string;
    citationExcerpt: string;
    ambiguityFlags: readonly string[];
  }[];
  errorCode?: string;
}

export interface PrivatePacketManifestSource {
  state: "ready" | "input_changed";
  input_version_vector: Record<string, unknown> | null;
  manifest_input: Record<string, unknown> | null;
}

export interface PrivatePacketExportFile { object_path: string; archive_name: string; }
export interface PublishedSourceCheckSource { source_url: string; }
export interface TelegramNotificationDeliverySource { telegram_chat_id: bigint; deep_link: string | null; }

export interface PrivatePacketManifestResult {
  jobId: string;
  fencingToken: bigint;
  ownerId: string;
  artifactRunId: string;
  deletionGeneration: number;
  objectPath: string;
  sha256: string;
  inputVersionVector: Readonly<Record<string, unknown>>;
}

export interface DocumentFormInspectionResult {
  jobId: string;
  fencingToken: bigint;
  ownerId: string;
  inspectionId: string;
  deletionGeneration: number;
  state: "completed" | "needs_input" | "failed";
  formState?: "fillable" | "assisted";
  reasonCode?: string;
  fields: readonly unknown[];
}

export interface PrivateAcroFormDerivativeSource {
  state: "ready" | "input_changed";
  input_version_vector: Record<string, unknown> | null;
  object_path: string | null;
  field_values: Record<string, string | boolean> | null;
}

export interface PrivateAcroFormDerivativeResult {
  jobId: string;
  fencingToken: bigint;
  ownerId: string;
  artifactRunId: string;
  deletionGeneration: number;
  objectPath: string;
  sha256: string;
  inputVersionVector: Readonly<Record<string, unknown>>;
  renderCheckStatus: "passed" | "failed";
}

export type FinishableJobState = "succeeded" | "failed" | "awaiting_user" | "awaiting_approval" | "budget_paused" | "cancelled" | "outcome_unknown";

/** Trusted-worker repository. All state transitions use narrow SQL functions. */
export class WorkerRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async claimNext(leaseSeconds = 90): Promise<ClaimedJob | null> {
    const rows = await this.sql.unsafe<ClaimedJob[]>("select * from public.claim_next_job($1)", [leaseSeconds]);
    return rows[0] ?? null;
  }

  async claimNextSupported(supportedKinds: readonly string[], leaseSeconds = 90): Promise<ClaimedJob | null> {
    if (supportedKinds.length === 0) return null;
    const rows = await this.sql.unsafe<ClaimedJob[]>(
      "select * from public.claim_next_supported_job($1, $2::text[])",
      [leaseSeconds, supportedKinds],
    );
    return rows[0] ?? null;
  }

  async heartbeat(jobId: string, fencingToken: bigint, leaseSeconds = 90): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ heartbeat_job: boolean }>>(
      "select public.heartbeat_job($1::uuid, $2::bigint, $3) as heartbeat_job",
      [jobId, fencingToken, leaseSeconds],
    );
    return rows[0]?.heartbeat_job === true;
  }

  async finish(jobId: string, fencingToken: bigint, state: FinishableJobState, errorCode?: string): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ finish_job: boolean }>>(
      "select public.finish_job($1::uuid, $2::bigint, $3::public.job_state, $4) as finish_job",
      [jobId, fencingToken, state, errorCode ?? null],
    );
    return rows[0]?.finish_job === true;
  }

  async recordHeartbeat(workerId: string, capabilities: readonly string[], currentJobId?: string): Promise<void> {
    await this.sql.unsafe(
      "select public.record_worker_heartbeat($1, to_jsonb($2::text[]), $3::uuid)",
      [workerId, capabilities, currentJobId ?? null],
    );
  }

  async beginDocumentExtraction(job: ClaimedJob, documentVersionId: string, deletionGeneration: number): Promise<ExtractableDocument | null> {
    if (job.owner_id === null) throw new Error("Document extraction jobs require an owner scope.");
    const rows = await this.sql.unsafe<ExtractableDocument[]>(
      "select * from public.begin_document_extraction($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, documentVersionId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordDocumentExtraction(result: DocumentExtractionResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_document_extraction: boolean }>>(
      "select public.record_document_extraction($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11::text::jsonb, $12::text::jsonb) as record_document_extraction",
      [
        result.jobId,
        result.fencingToken,
        result.ownerId,
        result.documentVersionId,
        result.deletionGeneration,
        result.extractorVersion,
        result.state,
        result.textObjectPath ?? null,
        result.textExcerpt ?? null,
        result.pageCount ?? null,
        JSON.stringify(result.uncertaintyFlags),
        JSON.stringify(result.provenance),
      ],
    );
    return rows[0]?.record_document_extraction === true;
  }

  async beginPublicSourceCapture(job: ClaimedJob, privateSnapshotId: string, deletionGeneration: number): Promise<CapturablePublicSource | null> {
    if (job.owner_id === null) throw new Error("Public source capture jobs require an owner scope.");
    const rows = await this.sql.unsafe<CapturablePublicSource[]>(
      "select * from public.begin_public_source_capture($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, privateSnapshotId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordPublicSourceCapture(result: PublicSourceCaptureResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_public_source_capture: boolean }>>(
      "select public.record_public_source_capture($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12) as record_public_source_capture",
      [
        result.jobId,
        result.fencingToken,
        result.ownerId,
        result.privateSnapshotId,
        result.deletionGeneration,
        result.state,
        result.finalUrl ?? null,
        result.sourceContentType ?? null,
        result.contentSha256 ?? null,
        result.textObjectPath ?? null,
        result.textExcerpt ?? null,
        result.errorCode ?? null,
      ],
    );
    return rows[0]?.record_public_source_capture === true;
  }

  async activeBudgetCampaignId(): Promise<string | null> {
    const rows = await this.sql.unsafe<Array<{ id: string }>>(
      "select id from public.budget_campaigns where name = 'papertrail-default' and state = 'active'",
      [],
    );
    return rows[0]?.id ?? null;
  }

  async beginPrivateRequirementProposal(job: ClaimedJob, proposalRunId: string, deletionGeneration: number): Promise<PrivateRequirementProposalSource | null> {
    if (job.owner_id === null) throw new Error("Private requirement proposal jobs require an owner scope.");
    const rows = await this.sql.unsafe<PrivateRequirementProposalSource[]>(
      "select * from public.begin_private_requirement_proposal($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, proposalRunId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordPrivateRequirementProposal(result: PrivateRequirementProposalResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_private_requirement_proposal: boolean }>>(
      "select public.record_private_requirement_proposal($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::text::jsonb, $10) as record_private_requirement_proposal",
      [
        result.jobId,
        result.fencingToken,
        result.ownerId,
        result.proposalRunId,
        result.deletionGeneration,
        result.state,
        result.model,
        result.responseId,
        JSON.stringify(result.candidates),
        result.errorCode,
      ],
    );
    return rows[0]?.record_private_requirement_proposal === true;
  }

  async beginPrivatePacketManifest(job: ClaimedJob, artifactRunId: string, deletionGeneration: number): Promise<PrivatePacketManifestSource | null> {
    if (job.owner_id === null) throw new Error("Packet manifest jobs require an owner scope.");
    const rows = await this.sql.unsafe<PrivatePacketManifestSource[]>(
      "select * from public.begin_private_packet_manifest($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, artifactRunId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordPrivatePacketManifest(result: PrivatePacketManifestResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_private_packet_manifest: boolean }>>(
      "select public.record_private_packet_manifest($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8::text::jsonb) as record_private_packet_manifest",
      [
        result.jobId,
        result.fencingToken,
        result.ownerId,
        result.artifactRunId,
        result.deletionGeneration,
        result.objectPath,
        result.sha256,
        JSON.stringify(result.inputVersionVector),
      ],
    );
    return rows[0]?.record_private_packet_manifest === true;
  }

  async privatePacketExportFiles(ownerId: string, applicationId: string): Promise<PrivatePacketExportFile[]> {
    return this.sql.unsafe<PrivatePacketExportFile[]>("select * from public.private_packet_export_files($1::uuid, $2::uuid)", [ownerId, applicationId]);
  }

  async recordPrivatePacketBundle(result: PrivatePacketManifestResult & { packetObjectPath: string; packetSha256: string }): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_private_packet_bundle: boolean }>>(
      "select public.record_private_packet_bundle($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::text::jsonb) as record_private_packet_bundle",
      [result.jobId, result.fencingToken, result.ownerId, result.artifactRunId, result.deletionGeneration, result.objectPath, result.sha256, result.packetObjectPath, result.packetSha256, JSON.stringify(result.inputVersionVector)],
    );
    return rows[0]?.record_private_packet_bundle === true;
  }

  async beginPublishedSourceCheck(job: ClaimedJob, sourceId: string): Promise<PublishedSourceCheckSource | null> {
    const rows = await this.sql.unsafe<PublishedSourceCheckSource[]>("select * from public.begin_published_source_check($1::uuid, $2::bigint, $3::uuid)", [job.id, job.fencing_token, sourceId]);
    return rows[0] ?? null;
  }

  async recordPublishedSourceCheck(job: ClaimedJob, sourceId: string, result: { state: "success" | "failed"; finalUrl?: string; contentType?: string; contentSha256?: string; errorCode?: string }): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_published_source_check: boolean }>>(
      "select public.record_published_source_check($1::uuid, $2::bigint, $3::uuid, $4, $5, $6, $7, $8) as record_published_source_check",
      [job.id, job.fencing_token, sourceId, result.state, result.finalUrl ?? null, result.contentType ?? null, result.contentSha256 ?? null, result.errorCode ?? null],
    );
    return rows[0]?.record_published_source_check === true;
  }

  async enqueueDuePublishedSourceChecks(intervalMinutes: number, limit: number): Promise<number> {
    const rows = await this.sql.unsafe<Array<{ enqueue_due_published_source_checks: number }>>(
      "select public.enqueue_due_published_source_checks($1, $2) as enqueue_due_published_source_checks",
      [intervalMinutes, limit],
    );
    return rows[0]?.enqueue_due_published_source_checks ?? 0;
  }

  async beginTelegramNotificationDelivery(job: ClaimedJob, deliveryId: string): Promise<TelegramNotificationDeliverySource | null> {
    if (job.owner_id === null) throw new Error("Telegram delivery jobs require an owner scope.");
    const rows = await this.sql.unsafe<TelegramNotificationDeliverySource[]>(
      "select * from public.begin_telegram_notification_delivery($1::uuid, $2::bigint, $3::uuid, $4::uuid)",
      [job.id, job.fencing_token, job.owner_id, deliveryId],
    );
    return rows[0] ?? null;
  }

  async recordTelegramNotificationDelivery(job: ClaimedJob, deliveryId: string, result: { state: "sent" | "failed" | "uncertain"; providerMessageId?: string; errorCode?: string }): Promise<boolean> {
    if (job.owner_id === null) throw new Error("Telegram delivery jobs require an owner scope.");
    const rows = await this.sql.unsafe<Array<{ record_telegram_notification_delivery: boolean }>>(
      "select public.record_telegram_notification_delivery($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7) as record_telegram_notification_delivery",
      [job.id, job.fencing_token, job.owner_id, deliveryId, result.state, result.providerMessageId ?? null, result.errorCode ?? null],
    );
    return rows[0]?.record_telegram_notification_delivery === true;
  }

  async failPrivatePacketManifest(job: ClaimedJob, artifactRunId: string, deletionGeneration: number, errorCode: string): Promise<boolean> {
    if (job.owner_id === null) throw new Error("Packet manifest jobs require an owner scope.");
    const rows = await this.sql.unsafe<Array<{ fail_private_packet_manifest: boolean }>>(
      "select public.fail_private_packet_manifest($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6) as fail_private_packet_manifest",
      [job.id, job.fencing_token, job.owner_id, artifactRunId, deletionGeneration, errorCode],
    );
    return rows[0]?.fail_private_packet_manifest === true;
  }

  async beginDocumentFormInspection(job: ClaimedJob, inspectionId: string, deletionGeneration: number): Promise<{ object_path: string } | null> {
    if (job.owner_id === null) throw new Error("Form inspection jobs require an owner scope.");
    const rows = await this.sql.unsafe<Array<{ object_path: string }>>(
      "select * from public.begin_document_form_inspection($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, inspectionId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordDocumentFormInspection(result: DocumentFormInspectionResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_document_form_inspection: boolean }>>(
      "select public.record_document_form_inspection($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::text::jsonb) as record_document_form_inspection",
      [result.jobId, result.fencingToken, result.ownerId, result.inspectionId, result.deletionGeneration, result.state, result.formState ?? null, result.reasonCode ?? null, JSON.stringify(result.fields)],
    );
    return rows[0]?.record_document_form_inspection === true;
  }

  async beginPrivateAcroFormDerivative(job: ClaimedJob, artifactRunId: string, deletionGeneration: number): Promise<PrivateAcroFormDerivativeSource | null> {
    if (job.owner_id === null) throw new Error("AcroForm derivative jobs require an owner scope.");
    const rows = await this.sql.unsafe<PrivateAcroFormDerivativeSource[]>(
      "select * from public.begin_private_acroform_derivative($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5)",
      [job.id, job.fencing_token, job.owner_id, artifactRunId, deletionGeneration],
    );
    return rows[0] ?? null;
  }

  async recordPrivateAcroFormDerivative(result: PrivateAcroFormDerivativeResult): Promise<boolean> {
    const rows = await this.sql.unsafe<Array<{ record_private_acroform_derivative: boolean }>>(
      "select public.record_private_acroform_derivative($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6, $7, $8::text::jsonb, $9) as record_private_acroform_derivative",
      [
        result.jobId,
        result.fencingToken,
        result.ownerId,
        result.artifactRunId,
        result.deletionGeneration,
        result.objectPath,
        result.sha256,
        JSON.stringify(result.inputVersionVector),
        result.renderCheckStatus,
      ],
    );
    return rows[0]?.record_private_acroform_derivative === true;
  }

  async failPrivateAcroFormDerivative(job: ClaimedJob, artifactRunId: string, deletionGeneration: number, errorCode: string): Promise<boolean> {
    if (job.owner_id === null) throw new Error("AcroForm derivative jobs require an owner scope.");
    const rows = await this.sql.unsafe<Array<{ fail_private_acroform_derivative: boolean }>>(
      "select public.fail_private_acroform_derivative($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5, $6) as fail_private_acroform_derivative",
      [job.id, job.fencing_token, job.owner_id, artifactRunId, deletionGeneration, errorCode],
    );
    return rows[0]?.fail_private_acroform_derivative === true;
  }
}
