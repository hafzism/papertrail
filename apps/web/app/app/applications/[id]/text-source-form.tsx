"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface TextSourceFormProps {
  applicationId: string;
}

export function TextSourceForm({ applicationId }: TextSourceFormProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!description.trim()) {
      setError("Enter a description to save it.");
      return;
    }

    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("add_application_text_description", {
      p_application_id: applicationId,
      p_description: description.trim(),
    });
    if (rpcError) {
      setSubmitting(false);
      setError("The description could not be saved. Please try again.");
      return;
    }

    setDescription("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form className="mt-5 grid gap-3" noValidate onSubmit={submit}>
      <div>
        <label className="block font-semibold" htmlFor="text-description">What is this application for?</label>
        <p className="mt-1 text-sm text-[var(--slate)]" id="text-description-help">This private note is not an official source. PaperTrail will keep it unresolved until a later step captures a reviewable notice or program source.</p>
        <textarea aria-describedby="text-description-help" className="mt-2 min-h-32 w-full rounded-md border border-[var(--border)] p-3" id="text-description" maxLength={12000} onChange={(event) => setDescription(event.target.value)} required value={description} />
      </div>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Saving description…" : "Save unresolved description"}</button>
    </form>
  );
}
