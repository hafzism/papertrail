import { notFound, redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../../src/lib/supabase/config";
import { createClient } from "../../../../src/lib/supabase/server";
import { PublicUrlSourceForm } from "./public-url-source-form";
import { RequirementDraftForm } from "./requirement-draft-form";
import { EvidenceBindingForm } from "./evidence-binding-form";
import { ConfirmEvidenceBinding } from "./confirm-evidence-binding";
import { TextSourceForm } from "./text-source-form";
import { CapturedSourceViewer } from "./captured-source-viewer";
import { ApplicationFactOverrideForm } from "./application-fact-override-form";
import { RequestRequirementProposal } from "./request-requirement-proposal";
import { AcceptRequirementProposal } from "./accept-requirement-proposal";
import { RequestPacketManifest } from "./request-packet-manifest";
import { PacketManifestViewer } from "./packet-manifest-viewer";
import { PrivateReviewPdfDownload } from "./private-review-pdf-download";
import { CreateChangeset } from "./create-changeset";
import { ApplicationNoteForm } from "./application-note-form";
import { CreateReferencePortalChangeset } from "./create-reference-portal-changeset";
import { PacketExportDownload } from "./packet-export-download";
import { LiveVoicePanel } from "./live-voice-panel";

interface ApplicationPageProps {
  params: Promise<{ id: string }>;
}

function displayFactValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default async function ApplicationPage({ params }: ApplicationPageProps) {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { id } = await params;
  if (!claims) redirect(`/login?next=/app/applications/${id}`);

  const { data: application, error } = await supabase
    .from("applications")
    .select("id, title, lifecycle_state, readiness_state, monitoring_enabled, created_at, program_cycles(cycle_label, programs(name, institutions(name))), tracked_activities!applications_activity_owner_fk(id, title), followup_actions!applications_followup_action_owner_fk(id, kind, state)")
    .eq("id", id)
    .maybeSingle();
  if (error || application === null) notFound();

  const applicationCycle = Array.isArray(application.program_cycles) ? application.program_cycles[0] : application.program_cycles;
  const applicationProgram = (Array.isArray(applicationCycle?.programs) ? applicationCycle.programs[0] : applicationCycle?.programs) as { name: string; institutions: { name: string } | { name: string }[] | null } | null;
  const applicationInstitution = Array.isArray(applicationProgram?.institutions) ? applicationProgram.institutions[0] : applicationProgram?.institutions;
  const linkedActivity = Array.isArray(application.tracked_activities) ? application.tracked_activities[0] : application.tracked_activities;
  const linkedFollowupAction = Array.isArray(application.followup_actions) ? application.followup_actions[0] : application.followup_actions;

  const { data: events } = await supabase
    .from("application_events")
    .select("id, event_type, redacted_summary, created_at, sequence")
    .eq("application_id", application.id)
    .order("sequence", { ascending: true });
  const { data: applicationNotes } = await supabase
    .from("application_notes")
    .select("id, body, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: sources } = await supabase
    .from("private_notice_snapshots")
    .select("id, source_kind, source_status, captured_text, source_url, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const sourceIds = sources?.map((source) => source.id) ?? [];
  const { data: captures } = sourceIds.length > 0
    ? await supabase
      .from("private_source_captures")
      .select("private_snapshot_id, capture_state, error_code, text_excerpt, text_object_path, final_url, source_content_type")
      .in("private_snapshot_id", sourceIds)
    : { data: [] };
  const captureBySourceId = new Map(captures?.map((capture) => [capture.private_snapshot_id, capture]));
  const { data: requirements } = await supabase
    .from("private_requirement_versions")
    .select("id, private_snapshot_id, kind, label, citation_excerpt, citation_source_hash, citation_basis, review_state, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: proposalRuns } = await supabase
    .from("private_requirement_proposal_runs")
    .select("id, private_snapshot_id, state, prompt_version, model_name, error_code, created_at, completed_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: requirementProposals } = await supabase
    .from("private_requirement_proposals")
    .select("id, run_id, private_snapshot_id, ordinal, logical_key, kind, label, citation_excerpt, citation_source_hash, citation_basis, ambiguity_flags, review_state, accepted_requirement_id, created_at, reviewed_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: packetManifestRuns } = await supabase
    .from("artifact_generation_runs")
    .select("id, state, error_code, generated_artifact_id, created_at, completed_at")
    .eq("application_id", application.id)
    .eq("kind", "packet_manifest")
    .order("created_at", { ascending: false });
  const { data: packetManifests } = await supabase
    .from("artifacts")
    .select("id, object_path, sha256, status, render_check_status, created_at")
    .eq("application_id", application.id)
    .eq("kind", "packet_manifest")
    .order("created_at", { ascending: false });
  const { data: packetExports } = await supabase
    .from("packet_exports")
    .select("id, manifest_artifact_id, object_path, sha256, status, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: filledAcroFormRuns } = await supabase
    .from("artifact_generation_runs")
    .select("id, state, error_code, generated_artifact_id, created_at, completed_at")
    .eq("application_id", application.id)
    .eq("kind", "filled_acroform")
    .order("created_at", { ascending: false });
  const { data: filledAcroForms } = await supabase
    .from("artifacts")
    .select("id, object_path, sha256, status, render_check_status, created_at")
    .eq("application_id", application.id)
    .eq("kind", "filled_acroform")
    .order("created_at", { ascending: false });
  const { data: changesets } = await supabase
    .from("changesets")
    .select("id, state, expires_at, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: referenceReceipts } = await supabase
    .from("reference_portal_receipts")
    .select("id, changeset_id, reference_code, payload_sha256, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const sourceOptions = sources?.map((source) => ({
    id: source.id,
    label: source.source_status === "pending_capture" ? "Registered public URL" : "Unresolved description",
  })) ?? [];
  const proposalSourceOptions = sources
    ?.filter((source) => source.source_kind === "text_description" && source.source_status === "unresolved" && Boolean(source.captured_text?.trim()))
    .map((source) => ({ id: source.id, label: `Unresolved description from ${new Date(source.created_at).toLocaleString()}` })) ?? [];
  const { data: completedDocumentVersions } = await supabase
    .from("document_versions")
    .select("id, original_filename")
    .eq("extraction_state", "completed")
    .order("created_at", { ascending: false });
  const { data: evidenceBindings } = await supabase
    .from("evidence_bindings")
    .select("id, private_requirement_id, document_version_id, binding_state, explanation, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: applicationFactOverrides } = await supabase
    .from("application_fact_overrides")
    .select("id, fact_key, value_json, source_kind, confirmed_at, supersedes_id, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: false });
  const { data: profileFacts } = await supabase
    .from("profile_fact_versions")
    .select("id, fact_key, value_json, source_kind, confirmation_state, created_at")
    .order("created_at", { ascending: false });
  const requirementById = new Map(requirements?.map((requirement) => [requirement.id, requirement]));
  const documentById = new Map(completedDocumentVersions?.map((version) => [version.id, version]));
  const sourceById = new Map(sources?.map((source) => [source.id, source]));
  const latestProfileFactByKey = new Map<string, NonNullable<typeof profileFacts>[number]>();
  for (const fact of profileFacts ?? []) {
    if (!latestProfileFactByKey.has(fact.fact_key)) latestProfileFactByKey.set(fact.fact_key, fact);
  }
  const latestOverrideByKey = new Map<string, NonNullable<typeof applicationFactOverrides>[number]>();
  for (const fact of applicationFactOverrides ?? []) {
    if (!latestOverrideByKey.has(fact.fact_key)) latestOverrideByKey.set(fact.fact_key, fact);
  }
  const effectiveFacts = new Map<string, { value: unknown; origin: "profile" | "application" }>();
  for (const [factKey, fact] of latestProfileFactByKey) effectiveFacts.set(factKey, { value: fact.value_json, origin: "profile" });
  for (const [factKey, fact] of latestOverrideByKey) effectiveFacts.set(factKey, { value: fact.value_json, origin: "application" });

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8">
      <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/app">Back to workspace</a>
      <section className="mt-6 border border-[var(--pt-rule)] bg-white p-6 shadow-none"><div className="flex flex-wrap items-start justify-between gap-5 border-b border-[var(--pt-rule)] pb-5"><div><p className="pt-eyebrow">Private draft casefile</p><h1 className="text-4xl font-semibold tracking-tight">{application.title}</h1><p className="mt-3 leading-7 text-[var(--slate)]">Lifecycle: {application.lifecycle_state.replaceAll("_", " ")} · Readiness: {application.readiness_state.replaceAll("_", " ")} · Not an official submission</p></div><div className="border border-[var(--pt-rule)] bg-[var(--pt-muted)] p-3"><p className="pt-eyebrow">Casefile reference</p><p className="font-mono text-xs">{application.id}</p></div></div><dl className="mt-5 grid gap-4 sm:grid-cols-3"><div><dt className="pt-eyebrow">Created</dt><dd className="font-mono text-xs">{new Date(application.created_at).toLocaleString()}</dd></div><div><dt className="pt-eyebrow">Source record</dt><dd className="text-sm">{applicationCycle ? `${applicationInstitution?.name ?? "Institution"} · ${applicationProgram?.name ?? "Program"}` : "Private one-off draft"}</dd></div><div><dt className="pt-eyebrow">Monitoring</dt><dd className="text-sm">{application.monitoring_enabled ? "Owner opted in" : "Not enabled"}</dd></div></dl></section>
      {linkedActivity ? <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm leading-6 text-[var(--slate)]">This is a follow-up draft linked to <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href={`/app/activities/${linkedActivity.id}`}>{linkedActivity.title}</a>{linkedFollowupAction ? ` · action: ${linkedFollowupAction.kind} (${linkedFollowupAction.state.replaceAll("_", " ")})` : ""}. It is a separate draft and does not alter the original activity or application record.</p> : null}
      <LiveVoicePanel applicationId={application.id} enabled={Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.MODEL_LIVE?.trim())} />
      <section className="mt-10 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="application-notes-title"><h2 className="text-2xl font-bold" id="application-notes-title">Private application conversation</h2><p className="mt-3 leading-7 text-[var(--slate)]">Keep decisions and follow-ups with this draft. PaperTrail does not invent a response or send these notes anywhere.</p><ApplicationNoteForm applicationId={application.id} />{applicationNotes?.length === 0 ? <p className="mt-5 text-sm text-[var(--slate)]">No private notes yet.</p> : <ul className="mt-5 grid gap-3">{applicationNotes?.map((note) => <li className="rounded-md bg-slate-50 p-4" key={note.id}><p className="whitespace-pre-wrap leading-7">{note.body}</p><p className="mt-2 text-xs text-[var(--slate)]">{new Date(note.created_at).toLocaleString()}</p></li>)}</ul>}</section>

      <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6" aria-labelledby="next-title">
        <h2 className="text-2xl font-bold" id="next-title">Source and next step</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">This application has no verified program, notice, or requirements yet. Add relevant private evidence in the vault; source descriptions remain visibly unresolved and cannot be treated as rules.</p>
        <a className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white" href="/app/vault">Add private evidence</a>
        {application.lifecycle_state === "draft" ? <><TextSourceForm applicationId={application.id} /><PublicUrlSourceForm applicationId={application.id} /></> : null}
      </section>

      <section className="mt-8" aria-labelledby="sources-title">
        <h2 className="text-2xl font-bold" id="sources-title">Private source notes</h2>
        {sources?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No source notes have been saved.</p> : null}
        <ul className="mt-4 grid gap-3">
          {sources?.map((source) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" id={`source-${source.id}`} key={source.id}>
            {(() => {
              const capture = captureBySourceId.get(source.id);
              const captureLabel = capture?.capture_state === "captured"
                ? "Captured privately — still unverified"
                : capture?.capture_state === "running"
                  ? "Capturing privately"
                  : capture?.capture_state === "needs_review"
                    ? "Capture needs review"
                    : capture?.capture_state === "failed"
                      ? "Capture failed"
                      : "Public URL awaiting safe capture";
              return <>
            <p className="font-semibold">{source.source_status === "pending_capture" ? captureLabel : "Unresolved description"}</p>
            {source.captured_text ? <p className="mt-2 whitespace-pre-wrap text-[var(--slate)]">{source.captured_text}</p> : null}
            {source.source_url ? <p className="mt-2 break-all font-mono text-sm text-[var(--slate)]">{source.source_url}</p> : null}
            {capture?.final_url && capture.final_url !== source.source_url ? <p className="mt-2 break-all font-mono text-sm text-[var(--slate)]">Captured final URL: {capture.final_url}</p> : null}
            {capture?.error_code ? <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Capture result: {capture.error_code.replaceAll("_", " ")}</p> : null}
            {capture?.text_excerpt ? <details className="mt-3 rounded-md bg-slate-50 p-3"><summary className="cursor-pointer font-semibold text-[var(--navy)]">Captured source preview</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--slate)]">{capture.text_excerpt}</p></details> : null}
            {capture?.text_object_path ? <CapturedSourceViewer objectPath={capture.text_object_path} /> : null}
              </>;
            })()}
          </li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="timeline-title">
        <h2 className="text-2xl font-bold" id="timeline-title">Timeline</h2>
        <ol className="mt-4 grid gap-3">
          {events?.map((event) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={event.id}><p className="font-semibold">{event.redacted_summary}</p><p className="mt-1 text-sm text-[var(--slate)]">{event.event_type.replaceAll("_", " ")}</p></li>)}
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="requirements-title">
        <h2 className="text-2xl font-bold" id="requirements-title">Unresolved requirements</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">These are private review items, not confirmed institutional requirements. They cannot make an application ready or establish eligibility.</p>
        {application.lifecycle_state === "draft" ? <RequirementDraftForm applicationId={application.id} sources={sourceOptions} /> : null}
        {requirements?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No unresolved requirements have been recorded.</p> : null}
        <ul className="mt-4 grid gap-3">
          {requirements?.map((requirement) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={requirement.id}>
            <p className="font-semibold">{requirement.label}</p>
            <p className="mt-1 text-sm text-[var(--slate)]">{requirement.kind} · {requirement.review_state}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--slate)]">{requirement.citation_excerpt}</p>
            <p className="mt-3 text-sm leading-6 text-[var(--slate)]">Citation basis: {requirement.citation_basis.replaceAll("_", " ")}</p>
            <p className="mt-1 min-w-0 break-words font-mono text-xs leading-5 text-[var(--slate)]">Source SHA-256: {requirement.citation_source_hash}</p>
            {sourceById.has(requirement.private_snapshot_id) ? <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={`#source-${requirement.private_snapshot_id}`}>View recorded source</a> : <p className="mt-3 text-sm text-[var(--slate)]">Recorded source is no longer available.</p>}
          </li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="proposal-title">
        <h2 className="text-2xl font-bold" id="proposal-title">Proposed requirements</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">Analysis is limited to an unresolved owner-provided text description. Every result is proposed, private, and unresolved until you accept it. Accepting a proposal creates a private review item; it does not verify an institution, determine eligibility, or submit anything.</p>
        {application.lifecycle_state === "draft" ? <RequestRequirementProposal applicationId={application.id} sources={proposalSourceOptions} /> : null}
        {proposalSourceOptions.length === 0 && application.lifecycle_state === "draft" ? <p className="mt-4 text-sm leading-6 text-[var(--slate)]">Add an unresolved text description above before requesting analysis. Captured URLs and other source types are deliberately excluded here.</p> : null}
        {proposalRuns?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No requirement analysis has been requested.</p> : null}
        <ul className="mt-4 grid gap-3">
          {proposalRuns?.map((run) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={run.id}>
            <p className="font-semibold">Analysis run: {run.state.replaceAll("_", " ")}</p>
            <p className="mt-1 text-sm text-[var(--slate)]">Prompt version: {run.prompt_version} · Model: {run.model_name ?? "not started"}</p>
            {sourceById.has(run.private_snapshot_id) ? <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={`#source-${run.private_snapshot_id}`}>View unresolved source</a> : null}
            {run.error_code ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Analysis needs attention: {run.error_code.replaceAll("_", " ")}</p> : null}
          </li>)}
        </ul>
        {requirementProposals?.length === 0 && proposalRuns && proposalRuns.length > 0 ? <p className="mt-4 text-[var(--slate)]">No proposed items have been produced yet.</p> : null}
        <ul className="mt-4 grid gap-3">
          {requirementProposals?.map((proposal) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={proposal.id}>
            <p className="font-semibold">{proposal.label}</p>
            <p className="mt-1 text-sm text-[var(--slate)]">Proposed · unresolved · {proposal.kind} · {proposal.logical_key}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--slate)]">{proposal.citation_excerpt}</p>
            <p className="mt-3 text-sm leading-6 text-[var(--slate)]">Citation basis: {proposal.citation_basis.replaceAll("_", " ")}</p>
            <p className="mt-1 min-w-0 break-words font-mono text-xs leading-5 text-[var(--slate)]">Source SHA-256: {proposal.citation_source_hash}</p>
            {proposal.ambiguity_flags.length > 0 ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900">Needs careful review: {proposal.ambiguity_flags.join(", ")}</p> : null}
            {sourceById.has(proposal.private_snapshot_id) ? <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={`#source-${proposal.private_snapshot_id}`}>View recorded source</a> : null}
            {proposal.review_state === "proposed" && application.lifecycle_state === "draft" ? <AcceptRequirementProposal proposalId={proposal.id} /> : null}
            {proposal.review_state === "accepted" ? <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">You accepted this proposed item as a private review item. It remains unverified and does not establish eligibility.</p> : null}
            {proposal.review_state === "rejected" ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-[var(--slate)]">You rejected this proposed item.</p> : null}
          </li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="packet-title">
        <h2 className="text-2xl font-bold" id="packet-title">Private packet manifest</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">This is a deterministic private inventory of currently confirmed evidence and recorded requirements. It is for review only: it is not a filled PDF, a ZIP, proof of completeness, or permission to submit.</p>
        {application.lifecycle_state === "draft" || application.lifecycle_state === "prepared" ? <RequestPacketManifest applicationId={application.id} /> : null}
        {packetManifestRuns?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No packet manifest has been requested.</p> : null}
        <ul className="mt-4 grid gap-3">
          {packetManifestRuns?.map((run) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={run.id}>
            <p className="font-semibold">Manifest run: {run.state.replaceAll("_", " ")}</p>
            {run.error_code ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Manifest needs attention: {run.error_code.replaceAll("_", " ")}</p> : null}
          </li>)}
        </ul>
        <ul className="mt-4 grid gap-3">
          {packetManifests?.map((manifest) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={manifest.id}>
            <p className="font-semibold">Review-only packet manifest</p>
            <p className="mt-1 text-sm text-[var(--slate)]">Status: {manifest.status.replaceAll("_", " ")} · Render check: {manifest.render_check_status.replaceAll("_", " ")}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-[var(--slate)]">SHA-256: {manifest.sha256}</p>
            <PacketManifestViewer objectPath={manifest.object_path} />
            {packetExports?.filter((packetExport) => packetExport.manifest_artifact_id === manifest.id).map((packetExport) => <div key={packetExport.id}><p className="mt-4 text-sm text-[var(--slate)]">Private review ZIP · {packetExport.status.replaceAll("_", " ")} · SHA-256 {packetExport.sha256}</p>{packetExport.status === "needs_review" ? <PacketExportDownload objectPath={packetExport.object_path} /> : <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-950">This bundle includes changed or removed evidence and is stale. Generate a fresh manifest before downloading a review bundle.</p>}</div>)}
          </li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="review-copy-title">
        <h2 className="text-2xl font-bold" id="review-copy-title">Private PDF review copies</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">These are separate, owner-requested copies from an ordinary fillable PDF. They are for review only: they never change the original file, verify eligibility, or authorize submission.</p>
        {filledAcroFormRuns?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No private PDF review copy has been requested for this application.</p> : null}
        <ul className="mt-4 grid gap-3">
          {filledAcroFormRuns?.map((run) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={run.id}>
            <p className="font-semibold">Review-copy run: {run.state.replaceAll("_", " ")}</p>
            {run.error_code ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Review copy needs attention: {run.error_code.replaceAll("_", " ")}</p> : null}
          </li>)}
        </ul>
        <ul className="mt-4 grid gap-3">
          {filledAcroForms?.map((artifact) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={artifact.id}>
            <p className="font-semibold">Review-only filled PDF</p>
            <p className="mt-1 text-sm text-[var(--slate)]">Status: {artifact.status.replaceAll("_", " ")} · Render check: {artifact.render_check_status.replaceAll("_", " ")}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-[var(--slate)]">SHA-256: {artifact.sha256}</p>
            <PrivateReviewPdfDownload objectPath={artifact.object_path} />
          </li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="commit-title">
        <h2 className="text-2xl font-bold" id="commit-title">Review external action</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">Create an exact, time-limited action envelope before any supported external browser work. Approval covers only the displayed destination and action; it is not a general permission to act.</p>
        {application.lifecycle_state === "draft" || application.lifecycle_state === "prepared" ? <CreateChangeset applicationId={application.id} /> : null}
        {changesets?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No external action review has been created.</p> : null}
        <ul className="mt-4 grid gap-3">{changesets?.map((changeset) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={changeset.id}><p className="font-semibold">Action review: {changeset.state.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-[var(--slate)]">Expires {new Date(changeset.expires_at).toLocaleString()}</p><a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={`/app/review/${changeset.id}`}>Review exact action</a></li>)}</ul>
      </section>

      <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6" aria-labelledby="reference-demo-title">
        <h2 className="text-2xl font-bold" id="reference-demo-title">Fictional reference portal demo</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">This is the working, labelled local demonstration route. It uses harmless test data, an immutable changeset, and explicit owner approval before recording a browser-local fictional acknowledgement. It never contacts an institution or changes this application's real submission state.</p>
        {application.lifecycle_state === "draft" || application.lifecycle_state === "prepared" ? <CreateReferencePortalChangeset applicationId={application.id} /> : null}
        {referenceReceipts?.length === 0 ? <p className="mt-5 text-sm text-[var(--slate)]">No fictional portal acknowledgement has been recorded.</p> : <ul className="mt-5 grid gap-3">{referenceReceipts?.map((receipt) => <li className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-950" key={receipt.id}><p className="font-semibold">Fictional acknowledgement: <span className="font-mono">{receipt.reference_code}</span></p><p className="mt-1">Recorded {new Date(receipt.created_at).toLocaleString()} · exact payload SHA-256 {receipt.payload_sha256}</p></li>)}</ul>}
      </section>

      <section className="mt-8" aria-labelledby="facts-title">
        <h2 className="text-2xl font-bold" id="facts-title">Application-specific facts</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">These private, owner-confirmed values apply only here. They never change your reusable profile facts or verify eligibility.</p>
        {application.lifecycle_state === "draft" ? <ApplicationFactOverrideForm applicationId={application.id} /> : null}
        {applicationFactOverrides?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No application-specific facts have been recorded.</p> : null}
        <ul className="mt-4 grid gap-3">
          {applicationFactOverrides?.map((fact) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={fact.id}><p className="font-semibold">{fact.fact_key}</p><p className="mt-2 break-words text-[var(--slate)]">{typeof fact.value_json === "string" ? fact.value_json : JSON.stringify(fact.value_json)}</p><p className="mt-2 text-sm text-[var(--slate)]">Owner confirmed · {fact.source_kind.replaceAll("_", " ")}</p>{fact.supersedes_id ? <p className="mt-1 text-sm text-[var(--slate)]">Supersedes an earlier application-specific value.</p> : null}</li>)}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="effective-facts-title">
        <h2 className="text-2xl font-bold" id="effective-facts-title">Facts in this application</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">The latest application-specific value takes precedence over the latest reusable profile value. This is context for review, not proof of eligibility or institutional verification.</p>
        {effectiveFacts.size === 0 ? <p className="mt-4 text-[var(--slate)]">No reusable or application-specific facts are available yet.</p> : null}
        <dl className="mt-4 grid gap-3">
          {[...effectiveFacts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([factKey, fact]) => {
            return <div className="rounded-lg border border-[var(--border)] bg-white p-4" key={factKey}>
              <dt className="font-semibold">{factKey}</dt>
              <dd className="mt-2 break-words text-[var(--slate)]">{displayFactValue(fact.value)}</dd>
              <dd className="mt-2 text-sm text-[var(--slate)]">{fact.origin === "application" ? "Application-specific override" : "Reusable profile fact"} · owner confirmed</dd>
            </div>;
          })}
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="evidence-title">
        <h2 className="text-2xl font-bold" id="evidence-title">Proposed evidence bindings</h2>
        <p className="mt-3 leading-7 text-[var(--slate)]">A completed vault document can be proposed as evidence for an unresolved item. Review remains required before any external use.</p>
        {application.lifecycle_state === "draft" ? <EvidenceBindingForm applicationId={application.id} documents={completedDocumentVersions?.map((version) => ({ id: version.id, label: version.original_filename })) ?? []} requirements={requirements?.map((requirement) => ({ id: requirement.id, label: requirement.label })) ?? []} /> : null}
        {evidenceBindings?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No evidence bindings have been proposed.</p> : null}
        <ul className="mt-4 grid gap-3">
          {evidenceBindings?.map((binding) => {
            const requirement = requirementById.get(binding.private_requirement_id);
            const document = documentById.get(binding.document_version_id);
            return <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={binding.id}>
              <p className="font-semibold capitalize">{binding.binding_state}</p>
              <dl className="mt-3 grid gap-2 text-sm leading-6">
                <div><dt className="font-semibold text-[var(--navy)]">Unresolved item</dt><dd className="text-[var(--slate)]">{requirement?.label ?? "Private item no longer available"}</dd></div>
                <div><dt className="font-semibold text-[var(--navy)]">Proposed document</dt><dd className="break-all text-[var(--slate)]">{document?.original_filename ?? "Private document no longer available"}</dd></div>
              </dl>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--slate)]">{binding.explanation}</p>
              {binding.binding_state === "proposed" ? <ConfirmEvidenceBinding bindingId={binding.id} /> : null}
              {binding.binding_state === "confirmed" ? <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">You confirmed this private evidence link. This does not verify the source, determine eligibility, or submit anything externally.</p> : null}
            </li>;
          })}
        </ul>
      </section>
    </main>
  );
}
