import { Database, FileKey2, Send, Settings2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";
import { createClient } from "../../../src/lib/supabase/server";
import { LanguagePreferenceForm } from "./language-preference-form";
import { PrivateDataExport } from "./private-data-export";
import { TelegramLinkControls } from "./telegram-link-controls";

export default async function SettingsPage() {
  if (getPublicSupabaseConfig() === null) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?next=/app/settings");
  const { data: profile } = await supabase
    .from("profiles")
    .select("language")
    .maybeSingle();
  const currentLanguage = profile?.language === "ml" ? "ml" : "en";
  const [{ data: applications }, { data: documents }, { data: activities }, { data: notifications }, { data: telegramLink }, { data: telegramIntents }, { data: telegramMessages }] = await Promise.all([
    supabase.from("applications").select("id, title, lifecycle_state, readiness_state, created_at"),
    supabase.from("documents").select("id, label, document_type, created_at").is("deleted_at", null),
    supabase.from("tracked_activities").select("id, activity_type, title, confirmation_state, tracking_state, created_at"),
    supabase.from("notifications").select("id, event_type, minimal_text, actionable_status, created_at, read_at"),
    supabase.from("telegram_channel_links").select("telegram_username, unlinked_at").maybeSingle(),
    supabase.from("telegram_link_intents").select("id, state, expires_at, telegram_username").in("state", ["pending", "awaiting_owner_confirmation"]).order("created_at", { ascending: false }).limit(1),
    supabase.from("telegram_inbound_messages").select("id, body, received_at").order("received_at", { ascending: false }).limit(10),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
      <a className="font-semibold text-[var(--navy)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--navy-dark)]" href="/app">Back to workspace</a>
      <div className="mt-8 flex items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--navy)] text-white"><Settings2 aria-hidden="true" className="size-6" /></div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--navy)]">Owner controls</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">Workspace settings</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--slate)]">Choose how PaperTrail handles your private workspace information. Credentials and provider secrets are never shown here.</p>
        </div>
      </div>

      <section className="mt-10" aria-labelledby="telegram-title">
        <h2 id="telegram-title" className="text-2xl font-bold">Telegram private chat</h2>
        <TelegramLinkControls botUsername={process.env.TELEGRAM_BOT_USERNAME?.trim() || null} link={telegramLink ?? null} pendingIntent={telegramIntents?.[0] ?? null} />
        {telegramMessages?.length ? <div className="mt-6"><h3 className="font-bold">Recent private Telegram text</h3><p className="mt-2 text-sm leading-6 text-[var(--slate)]">Messages are recorded privately but do not choose an application, confirm facts, or approve work.</p><ul className="mt-3 grid gap-3">{telegramMessages.map((message) => <li className="rounded-lg border border-[var(--border)] bg-white p-4" key={message.id}><p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p><p className="mt-2 text-xs text-[var(--slate)]">{new Date(message.received_at).toLocaleString()}</p></li>)}</ul></div> : null}
      </section>

      <section className="mt-10" aria-labelledby="private-data-title">
        <h2 id="private-data-title" className="text-2xl font-bold">Private data controls</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <a className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition-colors duration-200 hover:bg-slate-50" href="/app/profile">
            <FileKey2 aria-hidden="true" className="size-5 text-[var(--navy)]" />
            <h3 className="mt-4 font-bold">Confirmed profile facts</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--slate)]">Add and review the private facts that you have personally confirmed.</p>
          </a>
          <a className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition-colors duration-200 hover:bg-slate-50" href="/app/vault">
            <Database aria-hidden="true" className="size-5 text-[var(--navy)]" />
            <h3 className="mt-4 font-bold">Private document vault</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--slate)]">Review retained documents and remove a source when you no longer need it.</p>
          </a>
        </div>
        <PrivateDataExport overview={{ exportedAt: new Date().toISOString(), profile: profile ?? null, applications: applications ?? [], documents: documents ?? [], activities: activities ?? [], notifications: notifications ?? [] }} />
      </section>

      <section className="mt-10" aria-labelledby="language-title">
        <h2 id="language-title" className="text-2xl font-bold">Display language</h2>
        <p className="mt-2 max-w-2xl leading-7 text-[var(--slate)]">Choose the language PaperTrail should use for interface text as each screen gains translations. Source excerpts, names, identifiers, and previously recorded values remain exactly as received.</p>
        <LanguagePreferenceForm currentLanguage={currentLanguage} />
      </section>
    </main>
  );
}
