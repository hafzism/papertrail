"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ConfirmCandidateActivity({ activityId }: { activityId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function confirm(): Promise<void> { setSaving(true); setError(null); const { error: rpcError } = await createClient().rpc("confirm_candidate_tracked_activity", { p_activity_id: activityId }); setSaving(false); if (rpcError) { setError("This candidate could not be confirmed. Refresh and try again."); return; } router.refresh(); }
  return <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="candidate-confirm-title"><h2 className="font-bold text-amber-950" id="candidate-confirm-title">Owner confirmation required</h2><p className="mt-2 text-sm leading-6 text-amber-950">This record came from a receipt. It proves only that acknowledgement; it does not prove approval, enrollment, or that any next action is open. Confirm only if you want to manage it as a private activity.</p><button className="mt-4 min-h-11 rounded-lg bg-[var(--navy)] px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={saving} onClick={confirm} type="button">{saving ? "Confirming…" : "Confirm this private activity"}</button>{error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</section>;
}
