"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ModerateProposal({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function review(decision: "approved" | "rejected"): Promise<void> {
    setError(null); setSaving(decision);
    const { error: rpcError } = await createClient().rpc("moderate_directory_proposal", { p_proposal_id: proposalId, p_decision: decision, p_moderator_note: note.trim() || null });
    setSaving(null);
    if (rpcError) { setError("The review could not be saved. Refresh and try again."); return; }
    router.refresh();
  }
  return <div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-semibold" htmlFor={`moderator-note-${proposalId}`}>Moderator note (optional)<textarea className="min-h-20 rounded-md border border-[var(--border)] p-3" id={`moderator-note-${proposalId}`} maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} /></label>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}<div className="flex flex-wrap gap-3"><button className="min-h-11 rounded-lg bg-[var(--navy)] px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={saving !== null} onClick={() => review("approved")} type="button">{saving === "approved" ? "Publishing…" : "Approve and publish"}</button><button className="min-h-11 rounded-lg border border-red-200 bg-white px-4 py-2 font-semibold text-red-800 disabled:opacity-60" disabled={saving !== null} onClick={() => review("rejected")} type="button">{saving === "rejected" ? "Rejecting…" : "Reject proposal"}</button></div></div>;
}
