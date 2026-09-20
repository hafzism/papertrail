"use client";

import { useState } from "react";
import { createClient } from "../../src/lib/supabase/client";

export function SignInWithGoogle({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function signIn(): Promise<void> {
    setError(null);
    setStarting(true);
    try {
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", next);
      const { data, error: signInError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.toString(), skipBrowserRedirect: true },
      });
      if (signInError || !data.url) {
        setError("Google sign-in could not start. Check the configured provider and redirect URLs.");
        setStarting(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Google sign-in could not start. Refresh and try again.");
      setStarting(false);
    }
  }

  return (
    <div>
      <button aria-busy={starting} className="min-h-11 rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white hover:bg-[var(--navy-dark)] disabled:cursor-wait disabled:opacity-70" disabled={starting} onClick={() => void signIn()} type="button">
        {starting ? "Opening Google…" : "Continue with Google"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
    </div>
  );
}
