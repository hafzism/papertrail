"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface RequestRequirementProposalProps {
  applicationId: string;
  sources: ReadonlyArray<{ id: string; label: string }>;
}

/** Requests bounded model analysis of one owner-provided, unresolved text note. */
export function RequestRequirementProposal({ applicationId, sources }: RequestRequirementProposalProps) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestProposal(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!sourceId) {
      setError("Choose an unresolved text description to analyse.");
      return;
    }
    setRequesting(true);
    const { error: rpcError } = await createClient().rpc("request_private_requirement_proposal", {
      p_application_id: applicationId,
      p_private_snapshot_id: sourceId,
    });
    if (rpcError) {
      setRequesting(false);
      setError("The proposal request could not be queued. Refresh and try again.");
      return;
    }
    setRequesting(false);
    router.refresh();
  }

  if (sources.length === 0) return null;

  return <form className="mt-5 grid gap-3" noValidate onSubmit={requestProposal}>
    <label className="grid gap-1 text-sm font-semibold">Unresolved text description
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setSourceId(event.target.value)} value={sourceId}>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
      </select>
    </label>
    <p className="text-sm leading-6 text-[var(--slate)]">This requests bounded analysis of your private text only. Its output remains proposed and unresolved until you explicitly accept an individual item.</p>
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={requesting} type="submit">{requesting ? "Queueing analysis…" : "Request proposed requirements"}</button>
  </form>;
}
