"use client";

import { useEffect, useRef, useState } from "react";

type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "closed" | "failed";

export function LiveVoicePanel({ applicationId, enabled }: { applicationId: string; enabled: boolean }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(180);
  const connection = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const sessionId = useRef<string | null>(null);
  const endAt = useRef<number | null>(null);

  function cleanup(): void {
    connection.current?.close(); connection.current = null;
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    if (audio.current) { audio.current.srcObject = null; }
  }
  async function stop(reason: "closed" | "expired" = "closed"): Promise<void> {
    const id = sessionId.current; sessionId.current = null; cleanup(); setState(reason === "expired" ? "closed" : "closed");
    if (id) await fetch(`/api/voice/sessions/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
  useEffect(() => () => { void stop(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (endAt.current === null) return;
      const next = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000)); setRemainingSeconds(next);
      if (next === 0) { void stop("expired"); setError("The three-minute voice session ended. Start again if you still need help."); }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function start(): Promise<void> {
    if (!enabled || state === "connecting" || state === "listening" || state === "speaking") return;
    setError(null); setState("connecting"); setRemainingSeconds(180);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const peer = new RTCPeerConnection(); connection.current = peer;
      media.getTracks().forEach((track) => peer.addTrack(track, media));
      peer.ontrack = (event) => { if (!audio.current) audio.current = new Audio(); audio.current.srcObject = event.streams[0] ?? null; void audio.current.play().catch(() => undefined); };
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = (event) => { try { const message = JSON.parse(String(event.data)) as { type?: string }; if (message.type === "output_audio_buffer.started") setState("speaking"); if (message.type === "output_audio_buffer.stopped") setState("listening"); } catch { /* Realtime events are advisory UI signals. */ } };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      const response = await fetch("/api/voice/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId, sdp: offer.sdp }) });
      const result = await response.json() as { sessionId?: string; answerSdp?: string; expiresAt?: string; error?: string };
      if (!response.ok || !result.sessionId || !result.answerSdp || !result.expiresAt) throw new Error(result.error ?? "voice_start_failed");
      sessionId.current = result.sessionId; endAt.current = new Date(result.expiresAt).getTime();
      await peer.setRemoteDescription({ type: "answer", sdp: result.answerSdp }); setState("listening");
    } catch {
      cleanup(); setState("failed"); setError("Live voice could not start. Check microphone permission and that your configured OpenAI project has access to the selected live model.");
    }
  }

  if (!enabled) return <section className="mt-8 rounded-xl border border-[var(--border)] bg-slate-50 p-6" aria-labelledby="voice-title"><h2 className="text-2xl font-bold" id="voice-title">Live voice</h2><p className="mt-3 leading-7 text-[var(--slate)]">Live voice is not configured in this environment. It will stay unavailable until a supported live model is configured; no microphone permission is requested.</p></section>;
  const active = state === "connecting" || state === "listening" || state === "speaking";
  return <section className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="voice-title"><h2 className="text-2xl font-bold" id="voice-title">Live voice</h2><p className="mt-3 leading-7 text-[var(--slate)]">Start only when you want to speak. This three-minute session is scoped to this private draft; final external actions still require the authenticated review screen.</p><p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-[var(--slate)]">State: <span className="font-semibold text-[var(--foreground)]">{state}</span>{active ? ` · ${Math.ceil(remainingSeconds / 60)} minute${remainingSeconds > 60 ? "s" : ""} remaining` : ""}</p>{error ? <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><button className="min-h-11 rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={active} onClick={() => void start()} type="button">{state === "connecting" ? "Connecting…" : "Start live voice"}</button>{active ? <button className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-5 py-3 font-semibold text-[var(--navy)]" onClick={() => void stop()} type="button">Stop voice</button> : null}</div></section>;
}
