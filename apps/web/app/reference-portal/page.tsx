import { ReferencePortalForm } from "./reference-portal-form";

export default function ReferencePortalPage() {
  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold text-[var(--navy)] underline underline-offset-4" href="/">Back to PaperTrail</a>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Fictional reference portal</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight">Calicut Community Scholarship 2027</h1>
    <p className="mt-4 max-w-2xl leading-7 text-[var(--slate)]">This is a deliberately fictional, local demonstration portal for PaperTrail. It is not an institution, a government service, or a real application destination.</p>

    <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6" aria-labelledby="notice-title">
      <h2 className="text-2xl font-bold" id="notice-title">Demo notice</h2>
      <dl className="mt-4 grid gap-4 text-sm leading-6">
        <div><dt className="font-semibold text-[var(--navy)]">Cycle</dt><dd className="text-[var(--slate)]">2027 reference cycle</dd></div>
        <div><dt className="font-semibold text-[var(--navy)]">Deadline</dt><dd className="text-[var(--slate)]">30 June 2027, 17:00 Asia/Kolkata</dd></div>
        <div><dt className="font-semibold text-[var(--navy)]">Review requirement</dt><dd className="text-[var(--slate)]">A photo identity document and a current address document are required for this fictional demonstration.</dd></div>
      </dl>
    </section>

    <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6" aria-labelledby="application-title">
      <h2 className="text-2xl font-bold" id="application-title">Demo application</h2>
      <p className="mt-3 leading-7 text-[var(--slate)]">Use harmless test data only. Submitting creates a browser-local demonstration acknowledgement; no data leaves this browser or represents an external submission.</p>
      <ReferencePortalForm />
    </section>
  </main>;
}
