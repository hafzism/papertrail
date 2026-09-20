"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

const maximumBytes = 20 * 1024 * 1024;
const acceptedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buffer).then((hash) =>
    Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join(""),
  );
}

export function VaultUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  function selectFile(nextFile: File | null): void {
    setError(null);
    if (nextFile === null) {
      setFile(null);
      return;
    }
    if (!acceptedMimeTypes.has(nextFile.type)) {
      setFile(null);
      setError("Choose a PDF, JPEG, PNG, or WebP file.");
      return;
    }
    if (nextFile.size < 1 || nextFile.size > maximumBytes) {
      setFile(null);
      setError("Choose a non-empty file up to 20 MB.");
      return;
    }
    setFile(nextFile);
    if (!label.trim()) setLabel(nextFile.name.replace(/\.[^.]+$/, ""));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (file === null || !label.trim()) {
      setError("Choose a file and enter a document label.");
      return;
    }

    setStatus("uploading");
    const supabase = createClient();
    const digest = await sha256Hex(await file.arrayBuffer());
    const objectPath = `intake/${crypto.randomUUID()}/${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("private-documents").upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
      metadata: { sha256: digest },
    });
    if (uploadError) {
      setStatus("idle");
      setError("The private upload could not be completed. Please try again.");
      return;
    }

    const { error: intakeError } = await supabase.rpc("create_document_intake", {
      p_label: label.trim(),
      p_document_type: documentType.trim(),
      p_object_path: objectPath,
      p_sha256: digest,
      p_original_filename: file.name,
      p_mime_type: file.type,
      p_byte_size: file.size,
    });
    if (intakeError) {
      await supabase.storage.from("private-documents").remove([objectPath]);
      setStatus("idle");
      setError("The document record could not be created. The uploaded file was removed; please try again.");
      return;
    }

    router.replace("/app/vault?uploaded=1");
    router.refresh();
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
      <div>
        <label className="block font-semibold" htmlFor="document-file">Document file</label>
        <p className="mt-1 text-sm text-[var(--slate)]" id="document-file-help">PDF, JPEG, PNG, or WebP; up to 20 MB. Originals are stored privately.</p>
        <input accept="application/pdf,image/jpeg,image/png,image/webp" aria-describedby="document-file-help" className="mt-2 block w-full rounded-md border border-[var(--border)] bg-white p-2" id="document-file" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} required type="file" />
      </div>
      <div>
        <label className="block font-semibold" htmlFor="document-label">Document label</label>
        <input className="mt-2 min-h-11 w-full rounded-md border border-[var(--border)] px-3" id="document-label" maxLength={200} onChange={(event) => setLabel(event.target.value)} required value={label} />
      </div>
      <div>
        <label className="block font-semibold" htmlFor="document-type">Document type <span className="font-normal text-[var(--slate)]">(optional)</span></label>
        <input className="mt-2 min-h-11 w-full rounded-md border border-[var(--border)] px-3" id="document-type" maxLength={120} onChange={(event) => setDocumentType(event.target.value)} placeholder="For example, certificate or identity document" value={documentType} />
      </div>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={status === "uploading"} type="submit">
        {status === "uploading" ? "Uploading privately…" : "Add document"}
      </button>
    </form>
  );
}
