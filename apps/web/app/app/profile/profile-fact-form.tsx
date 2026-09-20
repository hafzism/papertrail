"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

type ValueType = "text" | "number" | "boolean";

export function ProfileFactForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [valueType, setValueType] = useState<ValueType>("text");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!/^[a-z][a-z0-9_.-]{0,119}$/.test(key.trim())) {
      setError("Use a fact key beginning with a lowercase letter, for example applicant_type.");
      return;
    }
    let parsedValue: string | number | boolean;
    if (valueType === "number") {
      parsedValue = Number(value);
      if (!Number.isFinite(parsedValue)) {
        setError("Enter a finite number.");
        return;
      }
    } else if (valueType === "boolean") {
      parsedValue = value === "true";
    } else {
      parsedValue = value.trim();
      if (!parsedValue) {
        setError("Enter a value for this fact.");
        return;
      }
    }
    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("record_owner_profile_fact", {
      p_fact_key: key.trim(),
      p_value_json: parsedValue,
    });
    setSubmitting(false);
    if (rpcError) {
      setError("This fact could not be saved. Check the key and value, then try again.");
      return;
    }
    setSuccess("Owner-confirmed fact saved. It is not an institutional verification.");
    setKey("");
    setValue("");
    router.refresh();
  }

  return <form className="mt-5 grid gap-3" noValidate onSubmit={submit}>
    <p className="text-sm leading-6 text-[var(--slate)]">Record only information you personally confirm. This creates a private owner assertion, not an official or institutional verification.</p>
    <label className="grid gap-1 text-sm font-semibold" htmlFor="profile-fact-key">Fact key
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="profile-fact-key" maxLength={120} onChange={(event) => setKey(event.target.value)} placeholder="applicant_type" value={key} />
    </label>
    <label className="grid gap-1 text-sm font-semibold" htmlFor="profile-fact-type">Value type
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" id="profile-fact-type" onChange={(event) => { const nextType = event.target.value as ValueType; setValueType(nextType); setValue(nextType === "boolean" ? "true" : ""); }} value={valueType}>
        <option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes or no</option>
      </select>
    </label>
    {valueType === "boolean" ? <label className="grid gap-1 text-sm font-semibold" htmlFor="profile-fact-value">Value
      <select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" id="profile-fact-value" onChange={(event) => setValue(event.target.value)} value={value}><option value="true">Yes</option><option value="false">No</option></select>
    </label> : <label className="grid gap-1 text-sm font-semibold" htmlFor="profile-fact-value">Value
      <input className="min-h-11 rounded-md border border-[var(--border)] px-3" id="profile-fact-value" inputMode={valueType === "number" ? "decimal" : "text"} maxLength={500} onChange={(event) => setValue(event.target.value)} type={valueType === "number" ? "number" : "text"} value={value} />
    </label>}
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    {success ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{success}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Saving fact…" : "Save owner-confirmed fact"}</button>
  </form>;
}
