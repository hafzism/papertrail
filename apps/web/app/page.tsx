import { FileCheck2, LockKeyhole, Settings2 } from "lucide-react";
import { getPublicSupabaseConfig } from "../src/lib/supabase/config";

export default function HomePage() {
  const canStart = getPublicSupabaseConfig() !== null;

  return (
    <main className="pt-public-page mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center gap-3 border-b border-[var(--pt-rule)] pb-5" aria-label="PaperTrail">
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

      <footer className="mt-auto pt-14 text-sm text-[var(--slate)]">
        Private evidence workspace · owner-controlled records · review boundaries explicit
      </footer>
    </main>
  );
}
