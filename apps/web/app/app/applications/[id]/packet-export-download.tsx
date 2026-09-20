"use client";

import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function PacketExportDownload({ objectPath }: { objectPath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function download(): Promise<void> {
    setError(null); setLoading(true);
    const { data, error: downloadError } = await createClient().storage.from("private-artifacts").download(objectPath);
    setLoading(false);
    if (downloadError || data === null) { setError("The private review bundle could not be downloaded. Refresh and try again."); return; }
    const url = URL.createObjectURL(data); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "papertrail-review-bundle.zip"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="mt-3 grid gap-2"><button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-60" disabled={loading} onClick={download} type="button">{loading ? "Preparing download…" : "Download private review bundle"}</button>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</div>;
}
