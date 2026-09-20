import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../../src/lib/supabase/config";
import { createClient } from "../../../../src/lib/supabase/server";
import { NewApplicationForm } from "./new-application-form";

export default async function NewApplicationPage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/applications/new");
  const { data: cycles } = await supabase
    .from("program_cycles")
    .select("id, cycle_label, programs(name, institutions(name))")
    .order("created_at", { ascending: false });
  const programCycles = (cycles ?? []).map((cycle) => {
    const program = (Array.isArray(cycle.programs) ? cycle.programs[0] : cycle.programs) as { name: string; institutions: { name: string } | { name: string }[] | null } | null;
    const institution = Array.isArray(program?.institutions) ? program.institutions[0] : program?.institutions;
    return { id: cycle.id, label: cycle.cycle_label, programName: program?.name ?? "Program", institutionName: institution?.name ?? "Institution" };
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-10 sm:px-8">
      <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/app">Back to workspace</a>
      <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">New application</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Start with an honest draft</h1>
      <p className="mt-4 leading-7 text-[var(--slate)]">This creates only a private draft and its timeline record. It does not infer an institution, requirements, eligibility, or submission state.</p>
      <NewApplicationForm programCycles={programCycles} />
    </main>
  );
}
