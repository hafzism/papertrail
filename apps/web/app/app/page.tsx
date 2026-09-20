import { ArrowUpRight, Bell, FilePlus2, FolderLock, ListChecks, ScrollText, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "../../src/lib/supabase/server";
import { getPublicSupabaseConfig } from "../../src/lib/supabase/config";

function Stamp({ children }: { children: React.ReactNode }) {
  return <span className="pt-stamp">{children}</span>;
}

export default async function ApplicationHome() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app");
  const [{ data: applications, error }, { data: followupActions }, { count: documentCount }, { count: factCount }] = await Promise.all([
    supabase.from("applications").select("id, title, lifecycle_state, readiness_state, monitoring_enabled, created_at, program_cycles(cycle_label, programs(name, institutions(name)))").order("created_at", { ascending: false }),
    supabase.from("followup_actions").select("id, kind, state, deadline_at, deadline_text, linked_application_id, tracked_activities(id, title)").in("state", ["needs_clarification", "available", "preparing", "awaiting_review"]).order("deadline_at", { ascending: true, nullsFirst: false }).limit(8),
    supabase.from("documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("profile_fact_versions").select("id", { count: "exact", head: true }).eq("confirmation_state", "owner_confirmed"),
  ]);

  return <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8">
    <section className="pt-docket-hero" aria-labelledby="workspace-title">
      <div className="pt-docket-strip"><span>Authenticated workspace</span><i aria-hidden="true" /><span>Owner-scoped record</span><i aria-hidden="true" /><span>Private storage</span></div>
      <div className="pt-hero-copy"><p className="pt-eyebrow">Workspace registry</p><h1 id="workspace-title">Your PaperTrail workspace</h1><p>Build a private record from the evidence you control. Every draft remains separate, reviewable, and clearly distinct from an external submission.</p></div>
      <dl className="pt-metric-grid"><div><dt>Active casefiles</dt><dd>{applications?.length ?? 0}</dd></div><div><dt>Vault documents</dt><dd>{documentCount ?? 0}</dd></div><div><dt>Confirmed facts</dt><dd>{factCount ?? 0}</dd></div><div><dt>Attention queue</dt><dd>{followupActions?.length ?? 0}</dd></div></dl>
    </section>

    <section className="pt-command-strip" aria-label="Workspace commands"><div className="pt-section-kicker"><span>Workspace command dispatch</span><span>Owner tools</span></div><div className="pt-command-actions"><a className="pt-button-primary" href="/app/applications/new"><FilePlus2 aria-hidden="true" className="size-4" /> Create application</a><a className="pt-button-secondary" href="/app/vault"><FolderLock aria-hidden="true" className="size-4" /> Open private vault</a><a className="pt-button-secondary" href="/app/profile"><ShieldCheck aria-hidden="true" className="size-4" /> Manage facts</a><a className="pt-button-secondary" href="/app/activities"><ScrollText aria-hidden="true" className="size-4" /> Activities</a><a className="pt-button-secondary" href="/app/notifications"><Bell aria-hidden="true" className="size-4" /> Notifications</a></div></section>

    <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="grid content-start gap-10">
      <section aria-labelledby="attention-title"><div className="pt-section-heading"><div><h2 id="attention-title">Attention queue</h2><Stamp>{followupActions?.length ?? 0} pending</Stamp></div><span>Private follow-up ledger</span></div>
        {followupActions?.length === 0 ? <div className="pt-empty-ledger"><ListChecks aria-hidden="true" className="size-6" /><p>No private follow-up actions are waiting for review.</p><small>All recorded items are either resolved or do not yet have an owner-confirmed next action.</small></div> : <ul className="pt-ledger-list">{followupActions?.map((action) => { const activity = Array.isArray(action.tracked_activities) ? action.tracked_activities[0] : action.tracked_activities; return <li key={action.id}><div><strong>{action.kind}</strong><p>{activity?.title ?? "Tracked activity"} · {action.state.replaceAll("_", " ")}{action.deadline_text ? ` · ${action.deadline_text}` : action.deadline_at ? ` · due ${new Date(action.deadline_at).toLocaleDateString()}` : ""}</p></div><a href={action.linked_application_id ? `/app/applications/${action.linked_application_id}` : `/app/activities/${activity?.id ?? ""}`}>Open record <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></li>; })}</ul>}
      </section>
      <section aria-labelledby="applications-title"><div className="pt-section-heading"><div><h2 id="applications-title">Your applications</h2><Stamp>{applications?.length ?? 0} casefiles</Stamp></div><a href="/app/applications/new">New draft <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></div>
        {error ? <p className="pt-alert" role="alert">Applications could not be loaded. Refresh and try again.</p> : null}
        {!error && applications?.length === 0 ? <div className="pt-empty-ledger"><FilePlus2 aria-hidden="true" className="size-6" /><p>No application drafts yet.</p><small>Create a casefile when you have a program, notice, or description to work from.</small></div> : null}
        <ul className="pt-casefile-list">{applications?.map((application) => { const cycle = Array.isArray(application.program_cycles) ? application.program_cycles[0] : application.program_cycles; const program = (Array.isArray(cycle?.programs) ? cycle.programs[0] : cycle?.programs) as { name: string; institutions: { name: string } | { name: string }[] | null } | null; const institution = Array.isArray(program?.institutions) ? program.institutions[0] : program?.institutions; return <li key={application.id}><div className="pt-casefile-strip"><span>Docket entry</span><span>{new Date(application.created_at).toLocaleDateString()}</span></div><div className="pt-casefile-body"><div><h3>{application.title}</h3><div className="mt-3 flex flex-wrap gap-2"><Stamp>Lifecycle: {application.lifecycle_state.replaceAll("_", " ")}</Stamp><Stamp>Readiness: {application.readiness_state.replaceAll("_", " ")}</Stamp>{application.monitoring_enabled ? <Stamp>Monitoring linked</Stamp> : null}</div>{cycle ? <p>{institution?.name ?? "Institution"} · {program?.name ?? "Program"} · {cycle.cycle_label}</p> : <p>Private one-off draft · no shared program record</p>}</div><a className="pt-button-secondary" href={`/app/applications/${application.id}`}>Open casefile <ArrowUpRight aria-hidden="true" className="size-4" /></a></div></li>; })}</ul>
      </section>
    </div><aside className="grid content-start gap-5" aria-label="Workspace context"><section className="pt-rail-panel"><div className="pt-rail-heading"><ShieldCheck aria-hidden="true" className="size-4" /> Evidence vault</div><p>Private evidence stays in your owner-scoped vault.</p><dl><div><dt>Documents</dt><dd>{documentCount ?? 0}</dd></div><div><dt>Confirmed facts</dt><dd>{factCount ?? 0}</dd></div></dl><a href="/app/vault">Inspect vault <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></section><section className="pt-rail-panel"><div className="pt-rail-heading">Review boundary</div><p>PaperTrail prepares private records. It does not represent an institution or submit on your behalf.</p><a href="/app/notices">Program notices <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></section></aside></div>
  </main>;
}
