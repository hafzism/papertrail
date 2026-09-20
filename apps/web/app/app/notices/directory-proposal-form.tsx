"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../src/lib/supabase/client";

export function DirectoryProposalForm() {
  const router = useRouter();
  const [institutionName, setInstitutionName] = useState("");
  const [programName, setProgramName] = useState("");
  const [cycleLabel, setCycleLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null); setSuccess(null);
    let url: URL;
    try { url = new URL(sourceUrl.trim()); } catch { setError("Enter a complete public HTTPS source URL."); return; }
    if (url.protocol !== "https:" || url.username || url.password) { setError("Use an HTTPS URL without embedded credentials."); return; }
    if (!institutionName.trim() || !programName.trim() || !cycleLabel.trim()) { setError("Enter an institution, program, and cycle label."); return; }
    setSaving(true);
    const { error: rpcError } = await createClient().rpc("submit_directory_proposal", {
      p_institution_name: institutionName.trim(), p_program_name: programName.trim(), p_cycle_label: cycleLabel.trim(),
      p_source_url: url.toString(), p_jurisdiction: jurisdiction.trim() || null, p_category: category.trim() || null,
    });
    setSaving(false);
    if (rpcError) { setError("The proposal could not be saved. Check the public source URL and try again."); return; }
    setInstitutionName(""); setProgramName(""); setCycleLabel(""); setSourceUrl(""); setJurisdiction(""); setCategory("");
    setSuccess("Proposal submitted for moderator review. Nothing is public until it is approved.");
    router.refresh();
  }

  return <form className="mt-5 grid gap-4" noValidate onSubmit={submit}>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-institution">Institution<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-institution" maxLength={200} onChange={(event) => setInstitutionName(event.target.value)} required value={institutionName} /></label>
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-program">Program<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-program" maxLength={200} onChange={(event) => setProgramName(event.target.value)} required value={programName} /></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-cycle">Cycle label<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-cycle" maxLength={120} onChange={(event) => setCycleLabel(event.target.value)} placeholder="For example, 2026–27" required value={cycleLabel} /></label>
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-source">Public source URL<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-source" inputMode="url" maxLength={2048} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://issuer.example/notice" required type="url" value={sourceUrl} /></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-jurisdiction">Jurisdiction (optional)<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-jurisdiction" maxLength={120} onChange={(event) => setJurisdiction(event.target.value)} value={jurisdiction} /></label>
      <label className="grid gap-1 text-sm font-semibold" htmlFor="directory-category">Category (optional)<input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="directory-category" maxLength={120} onChange={(event) => setCategory(event.target.value)} value={category} /></label>
    </div>
    <p className="text-sm leading-6 text-[var(--slate)]">Share only public program metadata and a public issuer URL. A moderator checks it before publication. Do not paste private applicant details, credentials, or uploads here.</p>
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    {success ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{success}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--navy-dark)] disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} type="submit">{saving ? "Submitting proposal…" : "Submit for moderator review"}</button>
  </form>;
}
