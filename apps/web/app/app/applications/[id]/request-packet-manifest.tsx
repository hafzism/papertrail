"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function RequestPacketManifest({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestManifest(): Promise<void> {
    setError(null);
    setRequesting(true);
    const { error: rpcError } = await createClient().rpc("request_private_packet_manifest", {
      p_application_id: applicationId,
    });
    setRequesting(false);
    if (rpcError) {
      setError("The packet manifest could not be queued. Refresh the application and try again.");
      return;
    }
    router.refresh();
  }

  return <div className="mt-5">
    <button className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={requesting} onClick={requestManifest} type="button">{requesting ? "Queueing manifest…" : "Prepare private packet manifest"}</button>
    {error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
