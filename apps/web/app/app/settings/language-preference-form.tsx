"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../src/lib/supabase/client";

type Language = "en" | "ml";

const languages: Array<{ value: Language; label: string; detail: string }> = [
  { value: "en", label: "English", detail: "English interface labels and guidance." },
  { value: "ml", label: "Malayalam · മലയാളം", detail: "Malayalam interface labels where translations are available. Official source text stays unchanged." },
];

export function LanguagePreferenceForm({ currentLanguage }: { currentLanguage: Language }) {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>(currentLanguage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const supabase = createClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      setSaving(false);
      setError("Your session could not be verified. Sign in again before changing this preference.");
      return;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ language })
      .eq("user_id", userResult.user.id);
    setSaving(false);
    if (updateError) {
      setError("The language preference could not be saved. Your existing preference was not changed.");
      return;
    }
    setSuccess("Language preference saved. Existing official source text and recorded values are not translated or changed.");
    router.refresh();
  }

  return (
    <form className="mt-5" noValidate onSubmit={submit}>
      <fieldset>
        <legend className="sr-only">Display language</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {languages.map((option) => (
            <label className={`block cursor-pointer rounded-xl border p-4 transition-colors duration-200 ${language === option.value ? "border-[var(--navy)] bg-slate-50" : "border-[var(--border)] bg-white hover:bg-slate-50"}`} key={option.value}>
              <span className="flex items-start gap-3">
                <input checked={language === option.value} className="mt-1 size-4 accent-[var(--navy)]" name="language" onChange={() => setLanguage(option.value)} type="radio" value={option.value} />
                <span>
                  <span className="block font-semibold">{option.label}</span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--slate)]">{option.detail}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {success ? <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{success}</p> : null}
      <button className="mt-5 min-h-11 rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--navy-dark)] disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} type="submit">{saving ? "Saving preference…" : "Save display language"}</button>
    </form>
  );
}
