"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";
export function ApproveChangeset({ changesetId }: { changesetId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [reviewed,setReviewed]=useState(false);
  async function approve(): Promise<void> { setSaving(true); setError(null); const { data, error: rpcError } = await createClient().rpc("approve_private_changeset", { p_changeset_id: changesetId }); setSaving(false); if (rpcError || data !== true) { setError("This review envelope is no longer current or has expired. Create a fresh review."); return; } router.refresh(); }
  return <><label className="mt-5 flex min-h-11 items-start gap-3 border border-[var(--pt-rule)] p-3 text-sm"><input className="mt-1" type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>I reviewed the exact values, files, destination and declarations above and authorize these listed actions.</span></label><button className="mt-5 min-h-11 cursor-pointer rounded-md bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving||!reviewed} onClick={() => void approve()} type="button">{saving ? "Recording approval…" : "Approve this exact envelope"}</button>{error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}</>;
}
