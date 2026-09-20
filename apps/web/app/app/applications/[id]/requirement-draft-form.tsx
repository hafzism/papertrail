"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface RequirementDraftFormProps {
  applicationId: string;
  sources: ReadonlyArray<{ id: string; label: string }>;
}

const kinds = ["document", "field", "eligibility", "deadline", "format", "fee", "declaration"] as const;

export function RequirementDraftForm({ applicationId, sources }: RequirementDraftFormProps) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [kind, setKind] = useState<(typeof kinds)[number]>("document");
  const [logicalKey, setLogicalKey] = useState("");
  const [label, setLabel] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!sourceId || !logicalKey.trim() || !label.trim() || !excerpt.trim()) {
      setError("Choose a source and complete every requirement field.");
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("add_private_requirement_draft", {
      p_application_id: applicationId,
      p_private_snapshot_id: sourceId,
      p_logical_key: logicalKey.trim(),
      p_kind: kind,
      p_label: label.trim(),
      p_citation_excerpt: excerpt.trim(),
    });
    if (rpcError) {
      setSubmitting(false);
      setError("The unresolved requirement could not be saved. Check the key format and try again.");
      return;
    }
    setLogicalKey("");
    setLabel("");
    setExcerpt("");
    setSubmitting(false);
    router.refresh();
  }

  if (sources.length === 0) return null;
  return <form className="mt-5 grid gap-3" noValidate onSubmit={submit}>
    <p className="text-sm leading-6 text-[var(--slate)]">Record only an unresolved item and the exact supporting excerpt. This does not confirm eligibility or create an authoritative rule.</p>
    <label className="grid gap-1 text-sm font-semibold">Source
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setSourceId(event.target.value)} value={sourceId}>{sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Requirement key
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" maxLength={120} onChange={(event) => setLogicalKey(event.target.value)} placeholder="application.identity_document" value={logicalKey} />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Kind
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setKind(event.target.value as (typeof kinds)[number])} value={kind}>{kinds.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Unresolved requirement
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" maxLength={500} onChange={(event) => setLabel(event.target.value)} value={label} />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Exact source excerpt
      <textarea className="min-h-28 rounded-md border border-[var(--border)] p-3" maxLength={4000} onChange={(event) => setExcerpt(event.target.value)} value={excerpt} />
    </label>
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Saving unresolved item…" : "Add unresolved requirement"}</button>
  </form>;
}
