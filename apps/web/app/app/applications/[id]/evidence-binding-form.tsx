"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface EvidenceBindingFormProps {
  applicationId: string;
  requirements: ReadonlyArray<{ id: string; label: string }>;
  documents: ReadonlyArray<{ id: string; label: string }>;
}

export function EvidenceBindingForm({ applicationId, requirements, documents }: EvidenceBindingFormProps) {
  const router = useRouter();
  const [requirementId, setRequirementId] = useState(requirements[0]?.id ?? "");
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [explanation, setExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!requirementId || !documentId || !explanation.trim()) {
      setError("Choose an unresolved requirement, a completed document, and an explanation.");
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("add_evidence_binding_draft", {
      p_application_id: applicationId,
      p_private_requirement_id: requirementId,
      p_document_version_id: documentId,
      p_explanation: explanation.trim(),
    });
    if (rpcError) {
      setSubmitting(false);
      setError("The proposed binding could not be saved. It may already exist or the document may not be completed.");
      return;
    }
    setExplanation("");
    setSubmitting(false);
    router.refresh();
  }

  if (requirements.length === 0 || documents.length === 0) return null;
  return <form className="mt-5 grid gap-3" noValidate onSubmit={submit}>
    <p className="text-sm leading-6 text-[var(--slate)]">This proposes a document-to-requirement link for later review. It is not a confirmation or an eligibility result.</p>
    <label className="grid gap-1 text-sm font-semibold">Unresolved requirement
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setRequirementId(event.target.value)} value={requirementId}>{requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.label}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Completed private document
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setDocumentId(event.target.value)} value={documentId}>{documents.map((document) => <option key={document.id} value={document.id}>{document.label}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Why this may support the item
      <textarea className="min-h-28 rounded-md border border-[var(--border)] p-3" maxLength={4000} onChange={(event) => setExplanation(event.target.value)} value={explanation} />
    </label>
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Saving proposed binding…" : "Propose evidence binding"}</button>
  </form>;
}
