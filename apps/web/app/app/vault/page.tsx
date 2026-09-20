import { redirect } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/server";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { VaultUpload } from "./vault-upload";
import { RetryExtraction } from "./retry-extraction";
import { RemoveDocument } from "./remove-document";
import { InspectForm } from "./inspect-form";
import { DownloadDocument } from "./download-document";

function describeExtractionFlag(flag: string): string {
  const messages: Record<string, string> = {
    DOCUMENT_IMAGE_OCR_PENDING: "This image was uploaded before local image OCR was enabled. Retry extraction to process it.",
    DOCUMENT_TEXT_UNAVAILABLE: "This scanned PDF needs OCR before text can be reviewed.",
    DOCUMENT_OCR_NOT_CONFIGURED: "This scan needs local OCR, which is not configured yet.",
    DOCUMENT_OCR_TEXT_UNAVAILABLE: "Local OCR could not read text from this scan.",
    DOCUMENT_OCR_FAILED: "Local OCR could not complete. Keep the original and review the scan manually.",
  };
  return messages[flag] ?? flag.replaceAll("_", " ");
}

interface VaultPageProps {
  searchParams: Promise<{ uploaded?: string }>;
}

export default async function VaultPage({ searchParams }: VaultPageProps) {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/vault");
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, label, document_type, created_at, latest_version_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const versionIds = documents?.flatMap((document) => document.latest_version_id ? [document.latest_version_id] : []) ?? [];
  const { data: versions } = versionIds.length > 0
    ? await supabase.from("document_versions").select("id, extraction_state, mime_type, object_path, original_filename").in("id", versionIds)
    : { data: [] };
  const { data: extractions } = versionIds.length > 0
    ? await supabase
      .from("document_extractions")
      .select("document_version_id, text_excerpt, page_count, uncertainty_flags, provenance")
      .in("document_version_id", versionIds)
    : { data: [] };
  const { data: formInspections } = versionIds.length > 0
    ? await supabase
      .from("document_form_inspections")
      .select("id, document_version_id, state, form_state, reason_code, fields, created_at")
      .in("document_version_id", versionIds)
      .order("created_at", { ascending: false })
    : { data: [] };
  const inspectionIds = formInspections?.map((inspection) => inspection.id) ?? [];
  const { data: formMappings } = inspectionIds.length > 0
    ? await supabase
      .from("document_form_field_mappings")
      .select("inspection_id, field_name, fact_key, value_json, created_at")
      .in("inspection_id", inspectionIds)
      .order("created_at", { ascending: false })
    : { data: [] };
  const { data: profileFactVersions } = await supabase
    .from("profile_fact_versions")
    .select("id, fact_key, value_json, confirmation_state, created_at")
    .eq("confirmation_state", "owner_confirmed")
    .order("created_at", { ascending: false });
  const { data: preparableApplications } = await supabase
    .from("applications")
    .select("id, title, lifecycle_state")
    .in("lifecycle_state", ["draft", "prepared"])
    .order("created_at", { ascending: false });
  const extractionStates = new Map(versions?.map((version) => [version.id, version.extraction_state]));
  const versionsById = new Map(versions?.map((version) => [version.id, version]));
  const extractionByVersion = new Map(extractions?.map((extraction) => [extraction.document_version_id, extraction]));
  const formInspectionByVersion = new Map<string, NonNullable<typeof formInspections>[number]>();
  formInspections?.forEach((inspection) => {
    if (!formInspectionByVersion.has(inspection.document_version_id)) formInspectionByVersion.set(inspection.document_version_id, inspection);
  });
  const mappingsByInspection = new Map<string, NonNullable<typeof formMappings>[number][]>();
  formMappings?.forEach((mapping) => {
    const current = mappingsByInspection.get(mapping.inspection_id) ?? [];
    current.push(mapping);
    mappingsByInspection.set(mapping.inspection_id, current);
  });
  const latestProfileFactByKey = new Map<string, NonNullable<typeof profileFactVersions>[number]>();
  profileFactVersions?.forEach((fact) => {
    if (!latestProfileFactByKey.has(fact.fact_key)) latestProfileFactByKey.set(fact.fact_key, fact);
  });
  const profileFacts = [...latestProfileFactByKey.values()];
  const params = await searchParams;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8">
      <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/app">Back to workspace</a>
      <div className="mt-8 border-b border-[var(--pt-rule)] pb-6"><p className="pt-eyebrow">System record classification · vault archive</p><div className="flex flex-wrap items-end justify-between gap-5"><div><h1 className="text-4xl font-semibold tracking-tight">Evidence you control</h1><p className="mt-3 max-w-2xl leading-7 text-[var(--slate)]">Each upload creates a private immutable version and queues evidence extraction. The source file is never turned into a public notice.</p></div><span className="pt-stamp">Immutable record active</span></div></div>
      {params.uploaded === "1" ? <p className="pt-alert mt-6" role="status">Document received. Extraction is queued and no fact has been treated as confirmed.</p> : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[24rem_minmax(0,1fr)]"><section className="border border-[var(--pt-rule)] bg-white p-6 shadow-none" aria-labelledby="add-document-title">
        <div className="flex items-center justify-between border-b border-[var(--pt-rule)] pb-4"><h2 className="text-xl font-semibold" id="add-document-title">Add a document</h2><span className="pt-stamp">Intake form</span></div>
        <VaultUpload />
      </section>

      <section aria-labelledby="documents-title">
        <div className="pt-section-heading"><div><h2 id="documents-title">Your documents</h2><span className="pt-stamp">{documents?.length ?? 0} active records</span></div><span>Private evidence index</span></div>
        {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Documents could not be loaded. Refresh the page or check the configured project.</p> : null}
        {!error && documents?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No documents have been added yet.</p> : null}
        <ul className="mt-4 grid gap-3">
          {documents?.map((document) => (
            <li className="overflow-hidden rounded-none border border-[var(--pt-rule)] bg-white p-0" key={document.id}>
              {(() => {
                const extraction = document.latest_version_id ? extractionByVersion.get(document.latest_version_id) : undefined;
                const version = document.latest_version_id ? versionsById.get(document.latest_version_id) : undefined;
                const formInspection = document.latest_version_id ? formInspectionByVersion.get(document.latest_version_id) : undefined;
                const flags = Array.isArray(extraction?.uncertainty_flags) ? extraction.uncertainty_flags.filter((flag): flag is string => typeof flag === "string") : [];
                return <>
              <div className="border-b border-[var(--pt-rule)] bg-[var(--pt-muted)] px-4 py-2"><span className="pt-stamp">Docket record</span></div><div className="p-4"><p className="font-semibold">{document.label}</p>
              <p className="mt-1 text-sm text-[var(--slate)]">{document.document_type ?? "Unclassified document"}</p><p className="mt-2 text-sm text-[var(--slate)]">
                Extraction: {document.latest_version_id ? (extractionStates.get(document.latest_version_id) ?? "status unavailable") : "not queued"}
              </p>
              {extraction?.page_count ? <p className="mt-1 text-sm text-[var(--slate)]">Pages detected: {extraction.page_count}</p> : null}
              {flags.length > 0 ? <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Needs attention: {flags.map(describeExtractionFlag).join(" ")}</p> : null}
              {document.latest_version_id && (flags.includes("DOCUMENT_TEXT_UNAVAILABLE") || flags.includes("DOCUMENT_OCR_NOT_CONFIGURED")) ? <RetryExtraction documentVersionId={document.latest_version_id} /> : null}
              {extraction?.text_excerpt ? <details className="mt-3 rounded-md bg-slate-50 p-3"><summary className="cursor-pointer font-semibold text-[var(--navy)]">Extracted text preview</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--slate)]">{extraction.text_excerpt}</p></details> : null}
              {document.latest_version_id && version?.mime_type === "application/pdf" ? <InspectForm documentVersionId={document.latest_version_id} inspection={formInspection} mappings={formInspection ? (mappingsByInspection.get(formInspection.id) ?? []) : []} profileFacts={profileFacts} applications={preparableApplications ?? []} /> : null}
              {document.latest_version_id && version ? <DownloadDocument filename={version.original_filename} objectPath={version.object_path} /> : null}
              <RemoveDocument documentId={document.id} label={document.label} />
              </div>
                </>;
              })()}
            </li>
          ))}
        </ul>
      </section></div>
    </main>
  );
}
