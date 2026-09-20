"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../src/lib/supabase/client";

export function CreateActivityForm() {
  const router = useRouter();
  const [activityType, setActivityType] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cleanType = activityType.trim();
    const cleanTitle = title.trim();
    setError(null);
    if (!cleanType || !cleanTitle) {
      setError("Enter an activity type and a title.");
      return;
    }
    setSaving(true);
    const { data, error: rpcError } = await createClient().rpc("create_owner_tracked_activity", {
      p_activity_type: cleanType,
      p_title: cleanTitle,
      p_scope_json: {},
    });
    setSaving(false);
    if (rpcError || typeof data !== "string") {
      setError("This activity could not be recorded. Nothing was created.");
      return;
    }
    router.push(`/app/activities/${data}`);
    router.refresh();
  }

  return <form className="mt-5 grid gap-4" noValidate onSubmit={submit}>
    <label className="grid gap-1 text-sm font-semibold" htmlFor="activity-type">Activity type
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="activity-type" maxLength={120} onChange={(event) => setActivityType(event.target.value)} placeholder="For example, certificate renewal" value={activityType} />
    </label>
    <label className="grid gap-1 text-sm font-semibold" htmlFor="activity-title">Title
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="activity-title" maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="For example, 2027 residence certificate" value={title} />
    </label>
    <p className="text-sm leading-6 text-[var(--slate)]">This records only your own confirmation. It does not prove approval, issuance, eligibility, or that PaperTrail is monitoring an organization.</p>
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--navy-dark)] disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} type="submit">{saving ? "Recording activity…" : "Record owner-confirmed activity"}</button>
  </form>;
}
