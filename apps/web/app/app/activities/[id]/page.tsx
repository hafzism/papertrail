import { notFound, redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../../src/lib/supabase/config";
import { createClient } from "../../../../src/lib/supabase/server";
import { ActivityFollowupControls, PrepareFollowupApplication, RecordOwnerFollowupAction } from "./activity-followup-controls";
import { ConfirmCandidateActivity } from "./confirm-candidate-activity";
import { EndActivity } from "./end-activity";
import { ResolveFollowupAction } from "./resolve-followup-action";

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect(`/login?next=/app/activities/${id}`);
  const { data: activity } = await supabase
    .from("tracked_activities")
    .select("id, activity_type, title, scope_json, confirmation_state, tracking_state, created_at, updated_at, expires_at, next_due_at")
    .eq("id", id)
    .maybeSingle();
  if (!activity) notFound();
  const { data: actions } = await supabase
    .from("followup_actions")
    .select("id, kind, state, applicability_result, deadline_at, deadline_text, linked_application_id")
    .eq("activity_id", id)
    .order("deadline_at", { ascending: true, nullsFirst: false });
  const { data: evidence } = await supabase
    .from("activity_evidence")
    .select("id, evidence_kind, supported_facts, confirmation_actor, confirmed_at, created_at")
    .eq("activity_id", id)
    .order("created_at", { ascending: false });

  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--navy-dark)]" href="/app/activities">Back to activities</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Owner-confirmed activity</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">{activity.title}</h1>
    <p className="mt-3 text-lg text-[var(--slate)]">{activity.activity_type}</p>
    <dl className="mt-8 grid gap-4 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm sm:grid-cols-2">
      <div><dt className="text-sm font-semibold text-[var(--slate)]">Confirmation</dt><dd className="mt-1 font-semibold">{activity.confirmation_state.replaceAll("_", " ")}</dd></div>
      <div><dt className="text-sm font-semibold text-[var(--slate)]">Monitoring</dt><dd className="mt-1 font-semibold">{activity.tracking_state}</dd></div>
      <div><dt className="text-sm font-semibold text-[var(--slate)]">Next due date</dt><dd className="mt-1 font-semibold">{formatDate(activity.next_due_at)}</dd></div>
      <div><dt className="text-sm font-semibold text-[var(--slate)]">Expiry date</dt><dd className="mt-1 font-semibold">{formatDate(activity.expires_at)}</dd></div>
    </dl>
    <p className="mt-5 rounded-md bg-amber-50 p-4 text-sm leading-6 text-amber-950">No organization or source coverage is connected to this record yet, so PaperTrail is not monitoring for notices or claiming that a next action is open.</p>
    {activity.confirmation_state === "candidate" ? <ConfirmCandidateActivity activityId={activity.id} /> : <ActivityFollowupControls activityId={activity.id} trackingState={activity.tracking_state} />}
    <section className="mt-10" aria-labelledby="activity-evidence-title">
      <h2 className="text-2xl font-bold" id="activity-evidence-title">Activity evidence</h2>
      <p className="mt-3 leading-7 text-[var(--slate)]">Evidence describes why this private record exists. It does not elevate a receipt into proof of approval, enrollment, issuance, or eligibility.</p>
      {evidence?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No activity evidence is recorded.</p> : <ul className="mt-4 grid gap-3">{evidence?.map((item) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={item.id}><p className="font-semibold">{item.evidence_kind.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-[var(--slate)]">Confirmation: {item.confirmation_actor ?? "not confirmed"}{item.confirmed_at ? ` · ${formatDate(item.confirmed_at)}` : ""}</p>{Object.keys(item.supported_facts ?? {}).length > 0 ? <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-[var(--slate)]">{JSON.stringify(item.supported_facts, null, 2)}</pre> : null}</li>)}</ul>}
    </section>
    <section className="mt-10" aria-labelledby="follow-up-title">
      <h2 className="text-2xl font-bold" id="follow-up-title">Follow-up actions</h2>
      {activity.confirmation_state === "candidate" ? <p className="mt-4 text-[var(--slate)]">Confirm this candidate activity before opting in or recording a private reminder.</p> : activity.tracking_state === "active" ? <RecordOwnerFollowupAction activityId={activity.id} /> : <p className="mt-4 text-[var(--slate)]">Opt in to follow-up tracking before recording a private reminder or next action.</p>}
      {actions?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No source-backed follow-up action is available for this activity.</p> : null}
      <ul className="mt-4 grid gap-3">
        {actions?.map((action) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={action.id}>
          <p className="font-semibold">{action.kind}</p>
          <p className="mt-1 text-sm text-[var(--slate)]">{action.state.replaceAll("_", " ")} · applicability {action.applicability_result}</p>
          <p className="mt-1 text-sm text-[var(--slate)]">Deadline: {action.deadline_text ?? formatDate(action.deadline_at)}</p>
          {action.linked_application_id ? <a className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--navy)] underline underline-offset-4" href={`/app/applications/${action.linked_application_id}`}>Open linked draft</a> : <PrepareFollowupApplication actionId={action.id} defaultTitle={`${activity.title} — ${action.kind}`} />}
          {!['completed', 'dismissed', 'expired', 'not_applicable'].includes(action.state) ? <ResolveFollowupAction actionId={action.id} /> : null}
        </li>)}
      </ul>
    </section>
    {activity.tracking_state !== "ended" ? <EndActivity activityId={activity.id} /> : <p className="mt-10 rounded-md bg-slate-50 p-4 text-sm text-[var(--slate)]">This activity is ended. Its private history remains available, but PaperTrail will not create new follow-up tracking for it.</p>}
  </main>;
}
