"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface ProgramCycleOption {
  id: string;
  label: string;
  programName: string;
  institutionName: string;
}

export function NewApplicationForm({ programCycles }: { programCycles: ProgramCycleOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [programCycleId, setProgramCycleId] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Enter an application title.");
      return;
    }

    setSubmitting(true);
    const { data, error: rpcError } = await createClient().rpc("create_application_draft", {
      p_title: title.trim(), p_program_cycle_id: programCycleId || null, p_monitoring_enabled: monitoringEnabled,
    });
    if (rpcError || typeof data !== "string") {
      setSubmitting(false);
      setError("The draft could not be created. Please try again.");
      return;
    }

    router.replace(`/app/applications/${data}`);
    router.refresh();
  }

  return (
    <form className="mt-8 grid gap-4" noValidate onSubmit={submit}>
      <div>
        <label className="block font-semibold" htmlFor="application-title">Application title</label>
        <p className="mt-1 text-sm text-[var(--slate)]" id="application-title-help">Use a recognizable name, such as the program, issuer, or purpose. You can refine its source details later.</p>
        <input aria-describedby="application-title-help" className="mt-2 min-h-11 w-full rounded-md border border-[var(--border)] px-3" id="application-title" maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} />
      </div>
      <div>
        <label className="block font-semibold" htmlFor="application-program-cycle">Directory program and cycle (optional)</label>
        <p className="mt-1 text-sm text-[var(--slate)]" id="application-program-cycle-help">Choose only a directory entry you recognize. Leaving this empty creates a private one-off draft.</p>
        <select aria-describedby="application-program-cycle-help" className="mt-2 min-h-11 w-full rounded-md border border-[var(--border)] bg-white px-3" id="application-program-cycle" onChange={(event) => { setProgramCycleId(event.target.value); if (!event.target.value) setMonitoringEnabled(false); }} value={programCycleId}>
          <option value="">Private one-off draft</option>
          {programCycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.institutionName} · {cycle.programName} · {cycle.label}</option>)}
        </select>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-slate-50 p-4 text-sm leading-6" htmlFor="application-monitoring">
        <input checked={monitoringEnabled} className="mt-1 size-4" disabled={!programCycleId} id="application-monitoring" onChange={(event) => setMonitoringEnabled(event.target.checked)} type="checkbox" />
        <span><span className="block font-semibold">Keep this draft linked for future notice updates</span>This records your opt-in for this program/cycle. If its moderator-enabled public source later has an approved revision, PaperTrail can notify you to review it. It does not claim that a deadline is open or that private requirements were re-evaluated.</span>
      </label>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? "Creating draft…" : "Create draft"}</button>
    </form>
  );
}
