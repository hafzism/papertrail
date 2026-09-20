import { redirect } from "next/navigation";
import { createClient } from "../../src/lib/supabase/server";
import { getPublicSupabaseConfig } from "../../src/lib/supabase/config";

export default async function ApplicationHome() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app");
  const [{ data: applications, error }, { data: followupActions }] = await Promise.all([
    supabase.from("applications").select("id, title, lifecycle_state, readiness_state, monitoring_enabled, created_at, program_cycles(cycle_label, programs(name, institutions(name)))").order("created_at", { ascending: false }),
    supabase.from("followup_actions").select("id, kind, state, deadline_at, deadline_text, linked_application_id, tracked_activities(id, title)").in("state", ["needs_clarification", "available", "preparing", "awaiting_review"]).order("deadline_at", { ascending: true, nullsFirst: false }).limit(8),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Authenticated workspace</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Your PaperTrail workspace</h1>
      <p className="mt-4 max-w-2xl leading-7 text-[var(--slate)]">Create a private draft, add evidence to your vault, and continue only with information you have actually reviewed. A draft does not claim that requirements have been verified.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className="inline-flex min-h-11 items-center rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white hover:bg-[var(--navy-dark)]" href="/app/applications/new">Create application</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/vault">Open private vault</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/profile">Manage confirmed facts</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/activities">Tracked activities</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/notifications">Notifications</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/notices">Programs and notices</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] hover:bg-slate-50" href="/app/settings">Workspace settings</a>
      </div>

      <section className="mt-10" aria-labelledby="attention-title">
        <h2 className="text-2xl font-bold" id="attention-title">Attention queue</h2>
        <p className="mt-2 max-w-2xl leading-7 text-[var(--slate)]">These are private follow-up records. An owner-recorded action is a reminder, not a verified notice or an eligibility decision.</p>
        {followupActions?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No active follow-up actions are waiting for review.</p> : <ul className="mt-4 grid gap-3">{followupActions?.map((action) => { const activity = Array.isArray(action.tracked_activities) ? action.tracked_activities[0] : action.tracked_activities; return <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={action.id}><p className="font-semibold">{action.kind}</p><p className="mt-1 text-sm text-[var(--slate)]">{activity?.title ?? "Tracked activity"} · {action.state.replaceAll("_", " ")}{action.deadline_text ? ` · ${action.deadline_text}` : action.deadline_at ? ` · due ${new Date(action.deadline_at).toLocaleDateString()}` : ""}</p><a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={action.linked_application_id ? `/app/applications/${action.linked_application_id}` : `/app/activities/${activity?.id ?? ""}`}>{action.linked_application_id ? "Open linked draft" : "Review activity"}</a></li>; })}</ul>}
      </section>

      <section className="mt-10" aria-labelledby="applications-title">
        <h2 className="text-2xl font-bold" id="applications-title">Your applications</h2>
        {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Applications could not be loaded. Refresh the page or check the configured project.</p> : null}
        {!error && applications?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No applications yet. Create a draft when you have a program, notice, or description to work from.</p> : null}
        <ul className="mt-4 grid gap-3">
          {applications?.map((application) => (
            <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={application.id}>
              <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href={`/app/applications/${application.id}`}>{application.title}</a>
              <p className="mt-1 text-sm text-[var(--slate)]">Lifecycle: {application.lifecycle_state.replaceAll("_", " ")} · Readiness: {application.readiness_state.replaceAll("_", " ")}</p>
              {(() => { const cycle = Array.isArray(application.program_cycles) ? application.program_cycles[0] : application.program_cycles; const program = (Array.isArray(cycle?.programs) ? cycle.programs[0] : cycle?.programs) as { name: string; institutions: { name: string } | { name: string }[] | null } | null; const institution = Array.isArray(program?.institutions) ? program.institutions[0] : program?.institutions; return cycle ? <p className="mt-1 text-sm text-[var(--slate)]">Program: {institution?.name ?? "Institution"} · {program?.name ?? "Program"} · {cycle.cycle_label}{application.monitoring_enabled ? " · linked for future updates" : ""}</p> : null; })()}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
