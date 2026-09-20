"use client";

import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

const maximumDisplayCharacters = 1_000_000;

export function PacketManifestViewer({ objectPath }: { objectPath: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadManifest(): Promise<void> {
    if (content !== null || loading) return;
    setLoading(true);
    setError(null);
    const { data, error: downloadError } = await createClient().storage.from("private-artifacts").download(objectPath);
    if (downloadError || data === null) {
      setLoading(false);
      setError("The private manifest could not be loaded. Refresh and try again.");
      return;
    }
    const nextContent = await data.text();
    if (nextContent.length > maximumDisplayCharacters) {
      setLoading(false);
      setError("The manifest exceeds the safe display limit. It remains stored privately for review.");
      return;
    }
    setContent(nextContent);
    setLoading(false);
  }

  return <div className="mt-3">
    <button aria-expanded={content !== null} className="min-h-11 rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={loadManifest} type="button">
      {loading ? "Loading private manifest…" : content === null ? "View private manifest" : "Private manifest loaded"}
    </button>
    {error ? <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="alert">{error}</p> : null}
    {content !== null ? <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-sm leading-6 text-[var(--slate)]">{content}</pre> : null}
  </div>;
}
