import { redirect } from "next/navigation";
import { SignInWithGoogle } from "./sign-in-with-google";
import { getPublicSupabaseConfig } from "../../src/lib/supabase/config";

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const config = getPublicSupabaseConfig();
  const next = safeNext(params.next);

  if (config === null) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-12">
        <section className="w-full rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm" aria-labelledby="signin-title">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Setup required</p>
          <h1 id="signin-title" className="mt-3 text-3xl font-bold tracking-tight">Sign-in is not configured yet.</h1>
          <p className="mt-4 leading-7 text-[var(--slate)]">A project owner must configure Supabase and the Google provider before any account can sign in. No alternative sign-in method is shown because it has not been configured or tested.</p>
          <a className="mt-6 inline-block font-semibold text-[var(--navy)] underline underline-offset-4" href="/">Return to PaperTrail</a>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-12">
      <section className="w-full rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm" aria-labelledby="signin-title">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Secure sign-in</p>
        <h1 id="signin-title" className="mt-3 text-3xl font-bold tracking-tight">Continue to your workspace.</h1>
        <p className="mt-4 leading-7 text-[var(--slate)]">Google is used only to sign in. PaperTrail does not request Gmail or Drive access.</p>
        {params.error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">The sign-in callback could not be completed. Please try again or check the project configuration.</p> : null}
        <div className="mt-6"><SignInWithGoogle next={next} /></div>
        <a className="mt-6 inline-block font-semibold text-[var(--navy)] underline underline-offset-4" href="/">Return to PaperTrail</a>
      </section>
    </main>
  );
}
