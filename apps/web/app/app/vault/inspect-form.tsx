"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

interface InspectionField {
  name: string;
  kind: string;
  required: boolean;
  options: string[];
}

interface FormInspection {
  id: string;
  state: string;
  form_state: string | null;
  reason_code: string | null;
  fields: unknown;
}

interface ProfileFact {
  id: string;
  fact_key: string;
  value_json: unknown;
}

interface FormFieldMapping {
  field_name: string;
  fact_key: string;
  value_json: unknown;
}

interface PreparableApplication {
  id: string;
  title: string;
  lifecycle_state: string;
}

interface InspectFormProps {
  documentVersionId: string;
  inspection?: FormInspection | undefined;
  profileFacts: readonly ProfileFact[];
  mappings: readonly FormFieldMapping[];
  applications: readonly PreparableApplication[];
}

function fieldsFrom(value: unknown): InspectionField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const field = item as Partial<InspectionField>;
    if (typeof field.name !== "string" || typeof field.kind !== "string") return [];
    return [{
      name: field.name,
      kind: field.kind,
      required: field.required === true,
      options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === "string") : [],
    }];
  });
}

function assistedMessage(code: string | null): string {
  const messages: Record<string, string> = {
    FORM_SIGNATURE_PRESENT: "This PDF has a signature field, so PaperTrail will not alter it automatically.",
    FORM_XFA_PRESENT: "This PDF uses an XFA form, which needs assisted review before any preparation.",
    FORM_NON_LATIN_TEXT: "This form contains non-Latin text and needs assisted review to preserve its content safely.",
    FORM_UNSUPPORTED_FIELD: "This PDF has field types that need assisted review.",
  };
  return code ? (messages[code] ?? "The form needs assisted review before any preparation.") : "The form needs assisted review before any preparation.";
}

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function compatibleFacts(field: InspectionField, facts: readonly ProfileFact[]): ProfileFact[] {
  return facts.filter((fact) => {
    if (field.kind === "checkbox") return typeof fact.value_json === "boolean";
    if (field.kind === "text") return typeof fact.value_json === "string";
    if (field.kind === "dropdown" || field.kind === "option_list" || field.kind === "radio") {
      return typeof fact.value_json === "string" && (field.options.length === 0 || field.options.includes(fact.value_json));
    }
    return false;
  });
}

export function InspectForm({ documentVersionId, inspection, profileFacts, mappings, applications }: InspectFormProps) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [mappingField, setMappingField] = useState<string | null>(null);
  const [selectedFactIds, setSelectedFactIds] = useState<Record<string, string>>({});
  const [applicationId, setApplicationId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [preparationStatus, setPreparationStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsFrom(inspection?.fields);
  const active = inspection?.state === "queued" || inspection?.state === "running";
  const latestMappingByField = new Map<string, FormFieldMapping>();
  mappings.forEach((mapping) => {
    if (!latestMappingByField.has(mapping.field_name)) latestMappingByField.set(mapping.field_name, mapping);
  });

  async function requestInspection(): Promise<void> {
    setRequesting(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("request_document_form_inspection", { p_document_version_id: documentVersionId });
    if (rpcError) {
      setRequesting(false);
      setError("The form could not be queued for inspection. Refresh the page and try again.");
      return;
    }
    router.refresh();
  }

  async function mapField(field: InspectionField): Promise<void> {
    if (!inspection) return;
    const profileFactVersionId = selectedFactIds[field.name];
    if (!profileFactVersionId) {
      setError(`Choose an owner-confirmed fact for ${field.name} first.`);
      return;
    }
    setMappingField(field.name);
    setError(null);
    const { error: rpcError } = await createClient().rpc("record_document_form_field_mapping", {
      p_inspection_id: inspection.id,
      p_field_name: field.name,
      p_profile_fact_version_id: profileFactVersionId,
    });
    setMappingField(null);
    if (rpcError) {
      setError("The mapping could not be recorded. Refresh and recheck that the selected value is compatible with this field.");
      return;
    }
    router.refresh();
  }

  async function requestDerivative(): Promise<void> {
    if (!inspection) return;
    if (!applicationId) {
      setError("Choose the draft application that this review copy belongs to.");
      return;
    }
    setPreparing(true);
    setError(null);
    setPreparationStatus(null);
    const { error: rpcError } = await createClient().rpc("request_private_acroform_derivative", {
      p_application_id: applicationId,
      p_inspection_id: inspection.id,
    });
    setPreparing(false);
    if (rpcError) {
      setError("The review copy could not be queued. Confirm at least one compatible mapping is saved, then try again.");
      return;
    }
    setPreparationStatus("Review copy queued. The original upload will remain unchanged.");
    router.refresh();
  }

  return <div className="mt-3 rounded-md border border-[var(--border)] bg-slate-50 p-3">
    <p className="text-sm font-semibold text-[var(--navy)]">PDF form inspection</p>
    {active ? <p className="mt-1 text-sm text-[var(--slate)]" role="status">{inspection?.state === "running" ? "Inspecting private form fields…" : "Form inspection is queued…"} This does not fill or submit the PDF.</p> : null}
    {inspection?.state === "completed" && inspection.form_state === "fillable" ? <>
      <p className="mt-1 text-sm text-emerald-900" role="status">{fields.length} reviewable form field{fields.length === 1 ? "" : "s"} found. No PDF has been changed.</p>
      <details className="mt-2 rounded bg-white p-2">
        <summary className="cursor-pointer font-semibold text-sm text-[var(--navy)]">Review detected fields</summary>
        {fields.length > 0 ? <ul className="mt-3 grid gap-3 text-sm text-[var(--slate)]">
          {fields.map((field) => {
            const compatible = compatibleFacts(field, profileFacts);
            const mapping = latestMappingByField.get(field.name);
            return <li className="rounded border border-[var(--border)] p-3" key={`${field.name}-${field.kind}`}>
              <p className="font-semibold text-[var(--navy)]">{field.name} <span className="font-normal text-[var(--slate)]">· {field.kind}{field.required ? " · required" : ""}</span></p>
              {field.options.length > 0 ? <p className="mt-1">Allowed options: {field.options.join(", ")}</p> : null}
              {mapping ? <p className="mt-2 rounded bg-emerald-50 p-2 text-emerald-900">Owner-confirmed mapping: {mapping.fact_key} → {displayValue(mapping.value_json)}</p> : null}
              {compatible.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="grid gap-1 font-semibold text-[var(--navy)]" htmlFor={`mapping-${field.name}`}>Map an owner-confirmed profile fact
                  <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)]" id={`mapping-${field.name}`} onChange={(event) => setSelectedFactIds((current) => ({ ...current, [field.name]: event.target.value }))} value={selectedFactIds[field.name] ?? ""}>
                    <option value="">Choose a compatible fact</option>
                    {compatible.map((fact) => <option key={fact.id} value={fact.id}>{fact.fact_key} — {displayValue(fact.value_json)}</option>)}
                  </select>
                </label>
                <button className="min-h-11 cursor-pointer rounded-md bg-[var(--navy)] px-4 py-2 font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={mappingField === field.name} onClick={() => void mapField(field)} type="button">{mappingField === field.name ? "Recording…" : mapping ? "Record replacement" : "Confirm mapping"}</button>
              </div> : <p className="mt-2 rounded bg-amber-50 p-2 text-amber-900">No compatible owner-confirmed profile fact is available for this field.</p>}
            </li>;
          })}
        </ul> : <p className="mt-2 text-sm text-[var(--slate)]">No ordinary fillable fields were found.</p>}
      </details>
      <div className="mt-3 rounded border border-[var(--border)] bg-white p-3">
        <p className="font-semibold text-sm text-[var(--navy)]">Prepare a private review copy</p>
        <p className="mt-1 text-sm leading-6 text-[var(--slate)]">This creates a separate PDF from the mappings you explicitly confirmed. It does not submit anything, verify eligibility, or modify your original document.</p>
        {mappings.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1 font-semibold text-sm text-[var(--navy)]" htmlFor={`derivative-application-${inspection.id}`}>Draft application
            <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" id={`derivative-application-${inspection.id}`} onChange={(event) => setApplicationId(event.target.value)} value={applicationId}>
              <option value="">Choose where this review copy belongs</option>
              {applications.map((application) => <option key={application.id} value={application.id}>{application.title} — {application.lifecycle_state}</option>)}
            </select>
          </label>
          <button className="min-h-11 cursor-pointer rounded-md bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={preparing || applications.length === 0} onClick={() => void requestDerivative()} type="button">{preparing ? "Queuing review copy…" : "Prepare review copy"}</button>
        </div> : <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">Save at least one owner-confirmed field mapping before preparing a review copy.</p>}
        {applications.length === 0 && mappings.length > 0 ? <p className="mt-2 text-sm text-amber-900">Create a draft application first, then return here to attach the review copy to it.</p> : null}
        {preparationStatus ? <p className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900" role="status">{preparationStatus}</p> : null}
      </div>
    </> : null}
    {inspection?.state === "needs_input" ? <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900" role="status">{assistedMessage(inspection.reason_code)}</p> : null}
    {inspection?.state === "failed" ? <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800" role="alert">The last inspection could not finish. You can safely retry it.</p> : null}
    {!active ? <button className="mt-3 min-h-11 cursor-pointer rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={requesting} onClick={requestInspection} type="button">
      {requesting ? "Queuing form inspection…" : inspection ? "Inspect form fields again" : "Inspect form fields"}
    </button> : null}
    {error ? <p className="mt-2 text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
