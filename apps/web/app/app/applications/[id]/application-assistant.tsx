"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../../src/lib/supabase/client";

interface Turn { id: string; message: string; reply: string | null; state: string; }
interface Correction { factKey: string; value: string | number | boolean; }

export function ApplicationAssistant({ applicationId, initialTurns }: { applicationId: string; initialTurns: Turn[] }) {
  const router = useRouter();
  const [turns, setTurns] = useState(initialTurns);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    if(message.trim().length>4000){setError("Edit your transcript to 4,000 characters or fewer before sending.");return;}
    const text = message.trim();
    setBusy(true); setError(null); setCorrection(null);
    try {
      const response = await fetch(`/api/applications/${applicationId}/assistant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, requestId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setTurns(current => [...current, { id: result.turnId, message: text, reply: result.reply, state: result.state }]);
      setCorrection(result.correction ?? null); setMessage("");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "save_provider_in_settings" ? "Save an OpenAI or Gemini key in Settings to use the assistant." : code === "application_changed_retry" ? "Your application changed. Send the question again to use the latest evidence." : "The assistant could not answer. Your evidence is saved; you can try again.");
    } finally { setBusy(false); }
  }
  async function confirmCorrection() {
    if (!correction) return;
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("record_application_fact_override", { p_application_id: applicationId, p_fact_key: correction.factKey, p_value_json: correction.value });
    setBusy(false);
    if (error) { setError("The correction could not be saved. Refresh and try again."); return; }
    setCorrection(null); router.refresh();
  }
  async function transcribe(file: File | undefined) {
    if (!file || busy) return;
    if (file.size > 20 * 1024 * 1024) { setError("Choose a voice note up to 20 MB and five minutes."); return; }
    setBusy(true); setError(null);
    try {
      const form = new FormData(); form.set("audio",file); form.set("requestId",crypto.randomUUID());
      const response = await fetch(`/api/applications/${applicationId}/transcribe`,{method:"POST",body:form});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.transcript);
      if(result.transcript.length>4000)setError("Your transcript is longer than one message. Edit it to 4,000 characters or fewer before sending; nothing has been discarded.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "save_provider_in_settings" ? "Save your OpenAI or Gemini key in Settings first." : "The voice note could not be transcribed. Choose a readable audio file under five minutes, or type your message.");
    } finally { setBusy(false); }
  }
  return <section className="mt-8 border border-[var(--pt-rule)] bg-white p-6" aria-labelledby="assistant-title">
    <h2 className="text-2xl font-bold" id="assistant-title">Application assistant</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--slate)]">Ask about your requirements, evidence or next step. Uses your selected AI provider. <a className="underline" href="/app/settings">Provider settings</a></p>
    <ol className="mt-5 grid max-h-96 gap-4 overflow-y-auto" aria-label="Application conversation">{turns.map(turn => <li className="grid gap-2" key={turn.id}><p className="ml-6 whitespace-pre-wrap border border-[var(--pt-rule)] p-3"><span className="block text-xs font-bold uppercase">You</span>{turn.message}</p>{turn.reply ? <p className="mr-6 whitespace-pre-wrap bg-[var(--pt-muted)] p-3"><span className="block text-xs font-bold uppercase">PaperTrail</span>{turn.state === "obsolete" ? "This answer was superseded by a change to your application. Ask again for the current state." : turn.reply}</p> : null}</li>)}</ol>
    {correction ? <div className="mt-4 border border-[var(--pt-rule)] p-4"><p className="text-sm font-semibold">Proposed correction for this application</p><p className="mt-2 break-words">{correction.factKey}: {String(correction.value)}</p><div className="mt-3 flex gap-3"><button className="min-h-11 border border-[var(--pt-rule)] px-4 font-semibold" disabled={busy} onClick={() => void confirmCorrection()} type="button">Confirm correction</button><button className="min-h-11 px-3 underline" onClick={() => setCorrection(null)} type="button">Dismiss</button></div></div> : null}
    <form className="mt-5 grid gap-3" onSubmit={send}><label className="grid gap-2 text-sm font-semibold">Your question<textarea className="min-h-24 border border-[var(--pt-rule)] bg-white p-3 font-normal" maxLength={4000} onChange={event => setMessage(event.target.value)} value={message} placeholder="What evidence is still missing?" /></label><label className="grid gap-2 text-sm">Or attach a voice note (up to five minutes)<input className="min-h-11 max-w-full" type="file" accept="audio/*,.ogg,.m4a,.wav,.mp3,.webm" disabled={busy} onChange={event => { const file=event.target.files?.[0]; event.target.value=""; void transcribe(file); }} /></label><p className="text-xs text-[var(--slate)]">Transcripts appear above for correction before you send them. Audio is not retained.</p>{error ? <p className="text-sm text-red-800" role="alert">{error}</p> : null}<button className="min-h-11 justify-self-start bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={busy || !message.trim()} type="submit">{busy ? "Working…" : "Ask PaperTrail"}</button><p className="text-sm text-[var(--slate)]" role="status">{busy ? "Preparing your message with the selected AI provider." : ""}</p></form>
  </section>;
}
