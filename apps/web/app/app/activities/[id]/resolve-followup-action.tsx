"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function ResolveFollowupAction({ actionId }: { actionId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState<"completed" | "dismissed" | null>(null); const [error, setError] = useState<string | null>(null);
  async function resolve(state: "completed" | "dismissed"): Promise<void> { setSaving(state); setError(null); const { error: rpcError } = await createClient().rpc("resolve_owner_followup_action", { p_action_id: actionId, p_state: state }); setSaving(null); if (rpcError) { setError("This action could not be updated. Refresh and try again."); return; } router.refresh(); }
  return <div className="mt-3 flex flex-wrap gap-3"><button className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-60" disabled={saving !== null} onClick={() => void resolve("completed")} type="button">{saving === "completed" ? "Saving…" : "Mark reviewed/completed"}</button><button className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-60" disabled={saving !== null} onClick={() => void resolve("dismissed")} type="button">{saving === "dismissed" ? "Saving…" : "Dismiss action"}</button>{error ? <p className="basis-full rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</div>;
}
