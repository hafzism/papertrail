import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { createClient } from "../../../src/lib/supabase/server";
import { DirectoryProposalForm } from "./directory-proposal-form";

export default async function NoticesPage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/notices");
  const { data: programs, error } = await supabase
    .from("programs")
    .select("id, name, jurisdiction, category, is_demo, institutions(name), program_cycles(id, cycle_label, starts_on, ends_on, policy_epoch), published_program_sources(source_url, published_at), published_notice_revisions(id, source_url, created_at)")
    .order("created_at", { ascending: false });
  const { data: proposals, error: proposalError } = await supabase
    .from("directory_proposals")
    .select("id, institution_name, program_name, cycle_label, source_url, state, moderator_note, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/app">Back to workspace</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Shared public source directory</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">Programs and notice coverage</h1>
    <p className="mt-4 max-w-3xl leading-7 text-[var(--slate)]">This directory contains only database-backed program records. A listed program is not a claim that a notice is current, applicable, or verified for your private application. Private text and uploaded evidence never appear here.</p>
    {error ? <p className="mt-8 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">The directory could not be loaded. Refresh and try again.</p> : null}
    <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="contribute-directory">
      <h2 className="text-xl font-bold" id="contribute-directory">Contribute a public program source</h2>
      <p className="mt-3 max-w-3xl leading-7 text-[var(--slate)]">A contribution is a request for a moderator to publish public program metadata. It is not a report of eligibility, a private application, or a promise that PaperTrail will monitor the source.</p>
      <DirectoryProposalForm />
    </section>
    <section className="mt-8" aria-labelledby="your-proposals"><h2 className="text-2xl font-bold" id="your-proposals">Your directory proposals</h2>
      {proposalError ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Your proposal history could not be loaded.</p> : null}
      {!proposalError && proposals?.length === 0 ? <p className="mt-4 text-[var(--slate)]">You have not submitted a directory proposal.</p> : null}
      <ul className="mt-4 grid gap-3">{proposals?.map((proposal) => <li className="rounded-xl border border-[var(--border)] bg-white p-5" key={proposal.id}><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{proposal.program_name} · {proposal.cycle_label}</p><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[var(--slate)]">{proposal.state}</span></div><p className="mt-2 text-sm text-[var(--slate)]">{proposal.institution_name} · <a className="underline underline-offset-2" href={proposal.source_url} rel="noreferrer" target="_blank">public source</a></p>{proposal.moderator_note ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-[var(--slate)]">Moderator note: {proposal.moderator_note}</p> : null}</li>)}</ul>
    </section>
    {!error && programs?.length === 0 ? <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6"><h2 className="text-xl font-bold">No published program directory entries yet</h2><p className="mt-3 leading-7 text-[var(--slate)]">Create a private draft and add its source description or a registered public URL. It stays owner-scoped unless a future moderator-published notice is available.</p><a className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--navy)] px-4 py-2 font-semibold text-white" href="/app/applications/new">Create private draft</a></section> : null}
    <ul className="mt-8 grid gap-4">{programs?.map((program) => {
      const institution = Array.isArray(program.institutions) ? program.institutions[0] : program.institutions;
      const cycles = Array.isArray(program.program_cycles) ? program.program_cycles : [];
      const sources = Array.isArray(program.published_program_sources) ? program.published_program_sources : [];
      const revisions = Array.isArray(program.published_notice_revisions) ? program.published_notice_revisions : [];
      return <li className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" key={program.id}><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{program.name}</h2>{program.is_demo ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[var(--slate)]">demo record</span> : null}</div><p className="mt-2 text-sm text-[var(--slate)]">{institution?.name ?? "Institution not recorded"}{program.jurisdiction ? ` · ${program.jurisdiction}` : ""}{program.category ? ` · ${program.category}` : ""}</p><h3 className="mt-5 font-semibold">Recorded cycles</h3>{cycles.length === 0 ? <p className="mt-2 text-sm text-[var(--slate)]">No cycle is currently recorded.</p> : <ul className="mt-3 grid gap-2">{cycles.map((cycle) => <li className="rounded-md bg-slate-50 p-3 text-sm text-[var(--slate)]" key={cycle.id}><span className="font-semibold text-[var(--foreground)]">{cycle.cycle_label}</span> · policy epoch {cycle.policy_epoch}{cycle.starts_on ? ` · starts ${cycle.starts_on}` : ""}{cycle.ends_on ? ` · ends ${cycle.ends_on}` : ""}</li>)}</ul>}<h3 className="mt-5 font-semibold">Published public sources</h3>{sources.length === 0 ? <p className="mt-2 text-sm text-[var(--slate)]">No public source is recorded.</p> : <ul className="mt-2 grid gap-2">{sources.map((source) => <li className="text-sm" key={source.source_url}><a className="font-semibold text-[var(--navy)] underline underline-offset-4" href={source.source_url} rel="noreferrer" target="_blank">Open published source</a></li>)}</ul>}<h3 className="mt-5 font-semibold">Moderator-recorded source revisions</h3>{revisions.length === 0 ? <p className="mt-2 text-sm text-[var(--slate)]">No source revision has been recorded.</p> : <ul className="mt-2 grid gap-2">{revisions.map((revision) => <li className="rounded-md bg-amber-50 p-3 text-sm text-amber-950" key={revision.id}>Recorded {new Date(revision.created_at).toLocaleString()} · <a className="font-semibold underline underline-offset-2" href={revision.source_url} rel="noreferrer" target="_blank">review source revision</a>. This record signals a source change, not eligibility or automatic private requirement analysis.</li>)}</ul>}</li>;
    })}</ul>
  </main>;
}
