"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function RequestSourceCheck({ sourceId }: { sourceId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function request(): Promise<void> { setError(null); setSaving(true); const { error: rpcError } = await createClient().rpc("request_published_source_check", { p_source_id: sourceId }); setSaving(false); if (rpcError) { setError("The check could not be queued. A one-minute cooldown applies after each request."); return; } router.refresh(); }
  return <div className="mt-3 grid gap-2"><button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-60" disabled={saving} onClick={request} type="button">{saving ? "Queuing check…" : "Check public source now"}</button>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</div>;
}
