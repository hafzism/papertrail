"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

export function CreateChangeset({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [path, setPath] = useState("/");
  const [kind, setKind] = useState("save_draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(): Promise<void> {
    setSaving(true); setError(null);
    const { error: rpcError } = await createClient().rpc("create_private_changeset", {
      p_application_id: applicationId, p_destination_origin: origin.trim(), p_destination_path: path.trim(), p_action_kind: kind,
    });
    setSaving(false);
    if (rpcError) { setError("The review envelope could not be created. Use an HTTPS origin and a path beginning with /."); return; }
    router.refresh();
  }
  return <div className="mt-5 grid gap-3 rounded-md bg-slate-50 p-4">
    <p className="text-sm leading-6 text-[var(--slate)]">PaperTrail will record this exact action envelope for review. It will not open, fill, upload to, or submit to this destination from this screen.</p>
    <label className="grid gap-1 text-sm font-semibold text-[var(--navy)]" htmlFor="changeset-origin">HTTPS destination origin
      <input className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)]" id="changeset-origin" onChange={(event) => setOrigin(event.target.value)} placeholder="https://portal.example.org" value={origin} />
    </label>
    <label className="grid gap-1 text-sm font-semibold text-[var(--navy)]" htmlFor="changeset-path">Destination path
      <input className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)]" id="changeset-path" onChange={(event) => setPath(event.target.value)} value={path} />
    </label>
    <label className="grid gap-1 text-sm font-semibold text-[var(--navy)]" htmlFor="changeset-action">Planned action
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)]" id="changeset-action" onChange={(event) => setKind(event.target.value)} value={kind}>
        <option value="save_draft">Save a portal draft</option><option value="disclose_fields">Disclose listed fields</option><option value="upload_attachment">Upload an attachment</option><option value="submit">Submit application</option><option value="send_institution_message">Send an institution message</option>
      </select>
    </label>
    <button className="min-h-11 w-fit cursor-pointer rounded-md bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} onClick={() => void create()} type="button">{saving ? "Creating review…" : "Create exact action review"}</button>
    {error ? <p className="text-sm text-red-800" role="alert">{error}</p> : null}
  </div>;
}
