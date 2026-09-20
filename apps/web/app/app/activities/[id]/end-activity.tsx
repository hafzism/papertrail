"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function EndActivity({ activityId }: { activityId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function end(): Promise<void> { setSaving(true); setError(null); const { error: rpcError } = await createClient().rpc("end_tracked_activity", { p_activity_id: activityId }); setSaving(false); if (rpcError) { setError("This activity could not be ended. Refresh and try again."); return; } router.refresh(); }
  return <section className="mt-10 border-t border-[var(--border)] pt-7" aria-labelledby="end-activity-title"><h2 className="text-lg font-bold" id="end-activity-title">End follow-up tracking</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--slate)]">This stops future follow-up for this activity. It retains the activity, actions, and earlier notifications for your private review.</p><button className="mt-4 min-h-11 rounded-lg border border-red-200 bg-white px-4 py-2 font-semibold text-red-800 disabled:opacity-60" disabled={saving} onClick={end} type="button">{saving ? "Ending activity…" : "End this activity"}</button>{error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</section>;
}
