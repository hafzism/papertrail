import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { createClient } from "../../../src/lib/supabase/server";
import { ProfileFactForm } from "./profile-fact-form";

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default async function ProfilePage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/profile");
  const { data: facts, error } = await supabase
    .from("profile_fact_versions")
    .select("id, fact_key, value_json, source_kind, confirmation_state, confirmed_at, supersedes_id, created_at")
    .order("created_at", { ascending: false });

  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/app">Back to workspace</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Private profile facts</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">Facts you confirm</h1>
    <p className="mt-4 max-w-2xl leading-7 text-[var(--slate)]">Facts are private, versioned, and reusable. They support later review, but do not establish institutional eligibility or replace source evidence.</p>
    <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="add-fact-title">
      <h2 className="text-2xl font-bold" id="add-fact-title">Add an owner-confirmed fact</h2>
      <ProfileFactForm />
    </section>
    <section className="mt-8" aria-labelledby="facts-title">
      <h2 className="text-2xl font-bold" id="facts-title">Fact history</h2>
      {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">Facts could not be loaded. Refresh and try again.</p> : null}
      {!error && facts?.length === 0 ? <p className="mt-4 text-[var(--slate)]">No profile facts have been recorded.</p> : null}
      <ul className="mt-4 grid gap-3">
        {facts?.map((fact) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={fact.id}>
          <p className="font-semibold">{fact.fact_key}</p>
          <p className="mt-2 break-words text-[var(--slate)]">{displayValue(fact.value_json)}</p>
          <p className="mt-2 text-sm text-[var(--slate)]">{fact.confirmation_state.replaceAll("_", " ")} · {fact.source_kind.replaceAll("_", " ")}</p>
          {fact.supersedes_id ? <p className="mt-1 text-sm text-[var(--slate)]">Supersedes an earlier owner-confirmed value.</p> : null}
        </li>)}
      </ul>
    </section>
  </main>;
}
