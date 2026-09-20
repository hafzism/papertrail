"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface PublicUrlSourceFormProps {
  applicationId: string;
}

export function PublicUrlSourceForm({ applicationId }: PublicUrlSourceFormProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError("Enter a complete HTTPS URL.");
      return;
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      setError("Enter a complete HTTPS URL without embedded credentials.");
      return;
    }

    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("add_application_public_url_source", {
      p_application_id: applicationId,
      p_source_url: parsed.toString(),
    });
    if (rpcError) {
      setSubmitting(false);
      setError("The source URL could not be saved. Confirm it is a public HTTPS URL and try again.");
      return;
    }

    setUrl("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form className="mt-6 grid gap-3" noValidate onSubmit={submit}>
      <div>
        <label className="block font-semibold" htmlFor="public-source-url">Public notice or program URL</label>
        <p className="mt-1 text-sm text-[var(--slate)]" id="public-source-url-help">The link is only registered for a later safe-capture step. It is not fetched now and does not establish a verified rule.</p>
        <input aria-describedby="public-source-url-help" className="mt-2 min-h-11 w-full rounded-md border border-[var(--border)] px-3" id="public-source-url" inputMode="url" maxLength={2048} onChange={(event) => setUrl(event.target.value)} placeholder="https://issuer.example/notices/current" required type="url" value={url} />
      </div>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Registering URL…" : "Register public URL"}</button>
    </form>
  );
}
