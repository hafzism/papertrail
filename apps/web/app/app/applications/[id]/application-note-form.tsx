"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ApplicationNoteForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cleanBody = body.trim();
    setError(null);
    if (!cleanBody) { setError("Write a note before saving."); return; }
    setSaving(true);
    const { error: rpcError } = await createClient().rpc("add_application_note", { p_application_id: applicationId, p_body: cleanBody });
    setSaving(false);
    if (rpcError) { setError("The private note could not be saved. Try again."); return; }
    setBody(""); router.refresh();
  }
  return <form className="mt-4 grid gap-3" noValidate onSubmit={submit}><label className="grid gap-1 text-sm font-semibold" htmlFor="application-note">New private note<textarea className="min-h-24 rounded-md border border-[var(--border)] p-3 font-normal" id="application-note" maxLength={4000} onChange={(event) => setBody(event.target.value)} placeholder="For example, call the issuer about the deadline." value={body} /></label><p className="text-sm leading-6 text-[var(--slate)]">This is owner-authored private context. It is not sent to an institution or interpreted as a requirement.</p>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}<button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-60" disabled={saving} type="submit">{saving ? "Saving note…" : "Save private note"}</button></form>;
}
