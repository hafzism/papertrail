"use client";

import { useState } from "react";

export function ReferencePortalForm() {
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  function submit(formData: FormData): void {
    const name = String(formData.get("name") ?? "").trim();
    const applicantType = String(formData.get("applicantType") ?? "").trim();
    if (!name || !applicantType) return;
    const nextReference = `DEMO-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    sessionStorage.setItem("papertrail-reference-portal-receipt", JSON.stringify({ name, applicantType, reference: nextReference, createdAt: new Date().toISOString() }));
    setReference(nextReference);
    setSubmitted(true);
  }

  return <form action={submit} className="mt-5 grid gap-4" noValidate>
    <label className="grid gap-1 font-semibold text-[var(--navy)]" htmlFor="reference-name">Applicant name
      <input className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" id="reference-name" name="name" required />
    </label>
    <label className="grid gap-1 font-semibold text-[var(--navy)]" htmlFor="reference-type">Applicant type
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-normal text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" defaultValue="" id="reference-type" name="applicantType" required>
        <option disabled value="">Choose a demo option</option>
        <option value="student">Student</option>
        <option value="community-member">Community member</option>
      </select>
    </label>
    <label className="flex items-start gap-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-[var(--slate)]" htmlFor="reference-declaration">
      <input className="mt-1 size-4 accent-[var(--navy)]" id="reference-declaration" name="declaration" required type="checkbox" />
      I understand this is a fictional reference portal and am using test data only.
    </label>
    <button className="min-h-11 w-fit cursor-pointer rounded-md bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" type="submit">Create demo acknowledgement</button>
    {submitted && reference ? <p className="rounded-md bg-emerald-50 p-3 text-sm leading-6 text-emerald-900" role="status">Demo acknowledgement recorded in this browser only. Reference: <span className="font-mono font-semibold">{reference}</span></p> : null}
  </form>;
}
