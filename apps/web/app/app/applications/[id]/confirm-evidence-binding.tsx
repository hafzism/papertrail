"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

export function ConfirmEvidenceBinding({ bindingId }: { bindingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setConfirming(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("confirm_evidence_binding", { p_evidence_binding_id: bindingId });
    if (rpcError) {
      setConfirming(false);
      setError("The evidence binding could not be confirmed. Refresh and try again.");
      return;
    }
    router.refresh();
  }

  return <div className="mt-3">
    <button className="min-h-10 rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={confirming} onClick={confirm} type="button">{confirming ? "Confirming…" : "Confirm this evidence link"}</button>
    {error ? <p className="mt-2 text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
