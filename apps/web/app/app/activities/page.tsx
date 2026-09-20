import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { createClient } from "../../../src/lib/supabase/server";
import { CreateActivityForm } from "./create-activity-form";

export default async function ActivitiesPage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/activities");
  const { data: activities, error } = await supabase
    .from("tracked_activities")
    .select("id, activity_type, title, confirmation_state, tracking_state, updated_at")
    .order("updated_at", { ascending: false });

  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--navy-dark)]" href="/app">Back to workspace</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Follow-up continuity</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">Tracked activities</h1>
    <p className="mt-4 max-w-2xl leading-7 text-[var(--slate)]">Keep a private record of an ongoing administrative activity. Monitoring remains off unless you explicitly opt in after eligible source coverage is available.</p>
    <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="record-activity-title">
      <h2 className="text-2xl font-bold" id="record-activity-title">Record an activity</h2>
      <CreateActivityForm />
    </section>
    <section className="mt-10" aria-labelledby="activity-history-title">
      <h2 className="text-2xl font-bold" id="activity-history-title">Your activities</h2>
      {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Activities could not be loaded. Refresh and try again.</p> : null}
      {!error && activities?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No activities have been recorded.</p> : null}
      <ul className="mt-4 grid gap-3">
        {activities?.map((activity) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={activity.id}>
          <a className="font-semibold text-[var(--navy)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--navy-dark)]" href={`/app/activities/${activity.id}`}>{activity.title}</a>
          <p className="mt-1 text-sm text-[var(--slate)]">{activity.activity_type} · {activity.confirmation_state.replaceAll("_", " ")} · monitoring {activity.tracking_state}</p>
        </li>)}
      </ul>
    </section>
  </main>;
}
