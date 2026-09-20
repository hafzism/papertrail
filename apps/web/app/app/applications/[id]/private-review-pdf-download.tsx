"use client";

import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

/** Downloads an owner-scoped review artifact only after an explicit user action. */
export function PrivateReviewPdfDownload({ objectPath }: { objectPath: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    if (loading) return;
    setLoading(true);
    setError(null);
    const { data, error: downloadError } = await createClient().storage.from("private-artifacts").download(objectPath);
    if (downloadError || data === null) {
      setLoading(false);
      setError("The private review copy could not be loaded. Refresh and try again.");
      return;
    }
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = "papertrail-review-copy.pdf";
    link.click();
    URL.revokeObjectURL(url);
    setLoading(false);
  }

  return <div className="mt-3">
    <button className="min-h-11 cursor-pointer rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={() => void download()} type="button">
      {loading ? "Loading review copy…" : "Download private review copy"}
    </button>
    {error ? <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="alert">{error}</p> : null}
  </div>;
}
