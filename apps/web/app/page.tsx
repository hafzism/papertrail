import { CircleCheck, FileCheck2, LockKeyhole, Settings2 } from "lucide-react";
import { getIntegrationStatus, type IntegrationState } from "../src/server/integration-status";
import { getPublicSupabaseConfig } from "../src/lib/supabase/config";

const statusCopy: Record<IntegrationState, { label: string; detail: string }> = {
  not_configured: {
    label: "Not configured",
    detail: "A project owner must add the local environment values before this service can be used.",
  },
  configured_unverified: {
    label: "Configured, not yet verified",
    detail: "Values are present locally. A dedicated integration check will verify the account when that workflow is implemented.",
  },
};

function IntegrationRow({ name, state }: { name: string; state: IntegrationState }) {
  const copy = statusCopy[state];

  return (
    <li className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="flex items-start gap-3">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--navy)]" />
        <div>
          <p className="font-semibold text-[var(--foreground)]">{name}: {copy.label}</p>
          <p className="mt-1 text-sm leading-6 text-[var(--slate)]">{copy.detail}</p>
        </div>
      </div>
    </li>
  );
}

export default function HomePage() {
  const integrations = getIntegrationStatus();
  const canStart = getPublicSupabaseConfig() !== null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center gap-3" aria-label="PaperTrail">
        <div className="grid size-10 place-items-center rounded-lg bg-[var(--navy)] text-white">
          <FileCheck2 aria-hidden="true" className="size-5" />
        </div>
        <div>
          <p className="text-lg font-bold tracking-tight text-[var(--navy)]">PaperTrail</p>
          <p className="text-sm text-[var(--slate)]">Evidence-first application workspace</p>
        </div>
      </header>

      <section className="mt-14 max-w-3xl" aria-labelledby="setup-title">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Evidence-first application workspace</p>
        <h1 id="setup-title" className="mt-3 text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
          From notice to application - with every change accounted for.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--slate)]">
          Keep private evidence, owner-confirmed facts, reviewable PDF copies, requirements, and packet manifests in one maintained record. PaperTrail makes its review boundaries explicit and never presents preparation as external submission.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a className="inline-flex min-h-11 items-center rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--navy-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" href="/login">
            {canStart ? "Start securely" : "View sign-in setup status"}
          </a>
          <a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" href="/reference-portal">Open fictional demo portal</a>
        </div>
      </section>

      <section className="mt-10 grid gap-5 md:grid-cols-2" aria-label="Foundation capabilities">
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <LockKeyhole aria-hidden="true" className="size-6 text-[var(--navy)]" />
          <h2 className="mt-4 text-xl font-bold">Private evidence, visible provenance</h2>
          <p className="mt-2 leading-7 text-[var(--slate)]">Owner-scoped storage, fenced worker jobs, AcroForm inspection, and immutable review artifacts keep the original evidence separate from generated copies.</p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <Settings2 aria-hidden="true" className="size-6 text-[var(--navy)]" />
          <h2 className="mt-4 text-xl font-bold">Honest preparation boundaries</h2>
          <p className="mt-2 leading-7 text-[var(--slate)]">A review copy and packet manifest are never submission claims. Signed, XFA, scanned, and non-Latin PDFs clearly route to assisted review.</p>
        </article>
      </section>

      <section className="mt-10 max-w-3xl" aria-labelledby="integration-title">
        <h2 id="integration-title" className="text-2xl font-bold tracking-tight">Local integration status</h2>
        <p className="mt-2 text-[var(--slate)]">This status only detects local configuration presence. It never reveals credential values.</p>
        <ul className="mt-4 grid gap-3" aria-label="Integration status list">
          <IntegrationRow name="Supabase" state={integrations.supabase} />
          <IntegrationRow name="OpenAI" state={integrations.openai} />
        </ul>
      </section>

      <footer className="mt-auto pt-14 text-sm text-[var(--slate)]">
        <a className="underline decoration-[var(--navy)] underline-offset-4 hover:text-[var(--navy)]" href="/api/health">
          View machine-readable health status
        </a>
      </footer>
    </main>
  );
}
