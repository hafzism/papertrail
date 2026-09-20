"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

/** Explicit acceptance is required before a model candidate becomes a private requirement record. */
export function AcceptRequirementProposal({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setAccepting(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("accept_private_requirement_proposal", {
      p_proposal_id: proposalId,
    });
    if (rpcError) {
      setAccepting(false);
      setError("This proposal could not be accepted. Refresh and try again.");
      return;
    }
    router.refresh();
  }

  return <div className="mt-3">
    <button className="min-h-10 rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={accepting} onClick={accept} type="button">{accepting ? "Accepting…" : "Accept proposed item"}</button>
    {error ? <p className="mt-2 text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
