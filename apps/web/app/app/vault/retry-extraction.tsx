"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

interface RetryExtractionProps {
  documentVersionId: string;
}

export function RetryExtraction({ documentVersionId }: RetryExtractionProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry(): Promise<void> {
    setRetrying(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("retry_document_extraction", { p_document_version_id: documentVersionId });
    if (rpcError) {
      setRetrying(false);
      setError("The extraction could not be requeued. Refresh the page and try again.");
      return;
    }
    router.refresh();
  }

  return <div className="mt-3">
    <button className="min-h-10 rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={retrying} onClick={retry} type="button">
      {retrying ? "Requeuing extraction…" : "Retry extraction"}
    </button>
    {error ? <p className="mt-2 text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
