"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ExecuteReferencePortal({ changesetId }: { changesetId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  async function execute(): Promise<void> { setError(null); setSaving(true); const { data, error: rpcError } = await createClient().rpc("execute_reference_portal_changeset", { p_changeset_id: changesetId }); setSaving(false); if (rpcError || typeof data !== "string") { setError("The fictional portal acknowledgement could not be recorded. Refresh and try again."); return; } setReference(data); router.refresh(); }
  return <div className="mt-5 grid gap-3"><p className="rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-950">You are about to execute only the built-in fictional reference portal demonstration. No institution is contacted and this is not a real application submission.</p>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}{reference ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">Fictional acknowledgement recorded: <span className="font-mono font-semibold">{reference}</span></p> : <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={saving} onClick={execute} type="button">{saving ? "Recording demo acknowledgement…" : "Execute fictional portal demo"}</button>}</div>;
}
