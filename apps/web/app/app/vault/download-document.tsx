"use client";
import { useState } from "react";
import { createClient } from "../../../src/lib/supabase/client";

export function DownloadDocument({ objectPath, filename }: { objectPath: string; filename: string }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  async function download(): Promise<void> {
    setLoading(true); setError(null);
    const { data, error: downloadError } = await createClient().storage.from("private-documents").download(objectPath);
    if (downloadError || !data) { setLoading(false); setError("The original document could not be loaded. Refresh and try again."); return; }
    const url = URL.createObjectURL(data); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); setLoading(false);
  }
  return <div className="mt-3"><button className="min-h-11 cursor-pointer rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={() => void download()} type="button">{loading ? "Loading original…" : "Download original"}</button>{error ? <p className="mt-2 text-sm text-red-800" role="alert">{error}</p> : null}</div>;
}
