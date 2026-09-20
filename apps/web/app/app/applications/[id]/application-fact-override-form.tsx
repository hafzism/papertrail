"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

type ValueType = "text" | "number" | "boolean";

export function ApplicationFactOverrideForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [valueType, setValueType] = useState<ValueType>("text");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!/^[a-z][a-z0-9_.-]{0,119}$/.test(key.trim())) {
      setError("Use a fact key beginning with a lowercase letter.");
      return;
    }
    const parsedValue = valueType === "number" ? Number(value) : valueType === "boolean" ? value === "true" : value.trim();
    if ((valueType === "number" && !Number.isFinite(parsedValue)) || (valueType === "text" && !parsedValue)) {
      setError("Enter a valid value.");
      return;
    }
    setSubmitting(true);
    const { error: rpcError } = await createClient().rpc("record_application_fact_override", {
      p_application_id: applicationId,
      p_fact_key: key.trim(),
      p_value_json: parsedValue,
    });
    setSubmitting(false);
    if (rpcError) {
      setError("The application-specific fact could not be saved. Refresh and try again.");
      return;
    }
    setKey(""); setValue(""); router.refresh();
  }

  return <form className="mt-5 grid gap-3" noValidate onSubmit={submit}>
    <p className="text-sm leading-6 text-[var(--slate)]">Use this only when a value differs for this application. It overrides the reusable profile fact here, not anywhere else.</p>
    <label className="grid gap-1 text-sm font-semibold">Fact key<input className="min-h-11 rounded-md border border-[var(--border)] px-3" maxLength={120} onChange={(event) => setKey(event.target.value)} placeholder="applicant_type" value={key} /></label>
    <label className="grid gap-1 text-sm font-semibold">Value type<select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => { const nextType = event.target.value as ValueType; setValueType(nextType); setValue(nextType === "boolean" ? "true" : ""); }} value={valueType}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes or no</option></select></label>
    {valueType === "boolean" ? <label className="grid gap-1 text-sm font-semibold">Value<select className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3" onChange={(event) => setValue(event.target.value)} value={value}><option value="true">Yes</option><option value="false">No</option></select></label> : <label className="grid gap-1 text-sm font-semibold">Value<input className="min-h-11 rounded-md border border-[var(--border)] px-3" inputMode={valueType === "number" ? "decimal" : "text"} maxLength={500} onChange={(event) => setValue(event.target.value)} type={valueType === "number" ? "number" : "text"} value={value} /></label>}
    {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <button className="min-h-11 justify-self-start rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Saving override…" : "Save application override"}</button>
  </form>;
}
