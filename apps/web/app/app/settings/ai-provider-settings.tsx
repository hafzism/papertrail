"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type Provider = "openai" | "gemini";
export interface AiProviderStatus { provider: Provider; model: string; updatedAt: string; }

const defaults: Record<Provider, string> = { openai: "gpt-5-mini", gemini: "gemini-2.5-flash" };

export function AiProviderSettings({ current }: { current: AiProviderStatus | null }) {
  const router = useRouter();
  const keyId = useId(); const modelId = useId();
  const [provider, setProvider] = useState<Provider>(current?.provider ?? "openai");
  const [model, setModel] = useState(current?.model ?? defaults[current?.provider ?? "openai"]);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function changeProvider(next: Provider): void { setProvider(next); setModel(defaults[next]); setMessage(null); setError(null); }
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(null); setMessage(null);
    if (apiKey.trim().length < 12) { setError("Paste a valid API key. It is encrypted before it is stored."); return; }
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(model)) { setError("Use a provider model ID with letters, numbers, dots, underscores, or hyphens."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/settings/ai-provider", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model, apiKey }), cache: "no-store" });
      if (!response.ok) throw new Error();
      setApiKey(""); setMessage(`${provider === "openai" ? "OpenAI" : "Gemini"} is saved for your private analysis.`); router.refresh();
    } catch { setError("The AI provider key could not be saved. Your prior provider setting was not changed."); }
    finally { setSaving(false); }
  }
  async function remove(): Promise<void> {
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/settings/ai-provider", { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error();
      setMessage("Your saved AI provider key was removed."); router.refresh();
    } catch { setError("The saved AI provider key could not be removed. Refresh and try again."); }
    finally { setSaving(false); }
  }
  return <section className="mt-10" aria-labelledby="ai-provider-title">
    <div className="flex items-start gap-3"><KeyRound aria-hidden="true" className="mt-1 size-5 text-[var(--navy)]" /><div><h2 id="ai-provider-title" className="text-2xl font-bold">Private AI provider</h2><p className="mt-2 max-w-2xl leading-7 text-[var(--slate)]">Use your own OpenAI or Gemini key for requirement analysis. PaperTrail encrypts it before storage, never displays it again, and sends private source text only after you explicitly request analysis.</p></div></div>
    {current ? <div className="mt-5 rounded-lg border border-[var(--border)] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">Saved: {current.provider === "openai" ? "OpenAI" : "Gemini"} · {current.model}</p><button className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:opacity-60" disabled={saving} onClick={remove} type="button">Remove saved key</button></div><p className="mt-2 text-sm leading-6 text-[var(--slate)]">The key itself is not available for viewing or export. Save a replacement below to change it.</p></div> : <div className="mt-5 rounded-lg border border-dashed border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--slate)]">No personal AI provider is saved. PaperTrail can use its workspace OpenAI configuration when available, or you can choose a provider below.</div>}
    <form className="mt-5 grid max-w-2xl gap-4" noValidate onSubmit={save}>
      <fieldset><legend className="text-sm font-semibold">Provider</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{(["openai", "gemini"] as const).map((option) => <label className={`cursor-pointer rounded-lg border p-4 ${provider === option ? "border-[var(--navy)] bg-slate-50" : "border-[var(--border)] bg-white"}`} key={option}><input checked={provider === option} className="mr-2 accent-[var(--navy)]" name="provider" onChange={() => changeProvider(option)} type="radio" value={option} /><span className="font-semibold">{option === "openai" ? "OpenAI" : "Gemini"}</span><span className="mt-1 block text-sm text-[var(--slate)]">{option === "openai" ? "Requirement analysis and optional live voice." : "Requirement analysis."}</span></label>)}</div></fieldset>
      <label className="grid gap-1 text-sm font-semibold" htmlFor={modelId}>Model ID<input autoComplete="off" className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-mono text-sm" id={modelId} onChange={(event) => setModel(event.target.value)} value={model} /></label>
      <label className="grid gap-1 text-sm font-semibold" htmlFor={keyId}>API key<input autoComplete="off" className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 font-mono text-sm" id={keyId} onChange={(event) => setApiKey(event.target.value)} placeholder={provider === "openai" ? "Paste your OpenAI API key" : "Paste your Gemini API key"} type="password" value={apiKey} /></label>
      <div className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm leading-6 text-[var(--slate)]"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--navy)]" /><p>Your key is encrypted on the server, is not returned after saving, and is used only for owner-authorized AI work.</p></div>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}{message ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{message}</p> : null}
      <button className="min-h-11 justify-self-start rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} type="submit">{saving ? "Saving private provider…" : current ? "Replace saved key" : "Save private provider"}</button>
    </form>
  </section>;
}
