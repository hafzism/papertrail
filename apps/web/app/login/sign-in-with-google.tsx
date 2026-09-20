"use client";

import { useState } from "react";
import { createClient } from "../../src/lib/supabase/client";

export function SignInWithGoogle({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function signIn(): Promise<void> {
    setError(null);
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const { error: signInError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });
    if (signInError) setError("Google sign-in could not start. Check the configured provider and redirect URLs.");
  }

  return (
    <div>
      <button className="min-h-11 rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white hover:bg-[var(--navy-dark)]" onClick={signIn} type="button">
        Continue with Google
      </button>
      {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
    </div>
  );
}
