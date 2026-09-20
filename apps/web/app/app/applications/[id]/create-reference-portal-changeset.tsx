"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function CreateReferencePortalChangeset({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [applicantType, setApplicantType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(null);
    if (!name.trim() || !applicantType) { setError("Enter harmless test data and choose an applicant type."); return; }
    setSaving(true);
    const { data, error: rpcError } = await createClient().rpc("create_reference_portal_changeset", { p_application_id: applicationId, p_demo_name: name.trim(), p_applicant_type: applicantType });
    setSaving(false);
    if (rpcError || typeof data !== "string") { setError("The demo review envelope could not be created."); return; }
    router.push(`/app/review/${data}`); router.refresh();
  }
  return <form className="mt-5 grid gap-4" noValidate onSubmit={submit}><label className="grid gap-1 text-sm font-semibold" htmlFor="reference-demo-name">Harmless test name<input className="min-h-11 rounded-md border border-[var(--border)] px-3 font-normal" id="reference-demo-name" maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="For example, Demo Student" value={name} /></label><label className="grid gap-1 text-sm font-semibold" htmlFor="reference-demo-type">Applicant type<select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal" id="reference-demo-type" onChange={(event) => setApplicantType(event.target.value)} value={applicantType}><option value="">Choose a demo option</option><option value="student">Student</option><option value="community-member">Community member</option></select></label><p className="text-sm leading-6 text-[var(--slate)]">This uses the built-in fictional reference portal only. It creates an exact review envelope and never contacts an institution.</p>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}<button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">{saving ? "Creating demo review…" : "Prepare fictional portal review"}</button></form>;
}
