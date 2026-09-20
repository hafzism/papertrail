"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ApproveSourceRevision({ observationId }: { observationId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function approve(): Promise<void> {
    setError(null); setSaving(true);
    const { error: rpcError } = await createClient().rpc("approve_published_source_revision", { p_observation_id: observationId });
    setSaving(false);
    if (rpcError) { setError("The revision could not be approved. Refresh and check the candidate state."); return; }
    router.refresh();
  }
  return <div className="mt-3 grid gap-2"><button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={saving} onClick={approve} type="button">{saving ? "Recording revision…" : "Approve source revision"}</button>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</div>;
}
