"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "working" | "closed" | "failed";
interface TranscriptLine { id: string; speaker: "You" | "PaperTrail"; text: string; }

export function LiveVoicePanel({ applicationId, enabled }: { applicationId: string; enabled: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(180);
  const connection = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const sessionId = useRef<string | null>(null);
  const endAt = useRef<number | null>(null);
  const generation = useRef(0);

  function cleanup() {
    connection.current?.close(); connection.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; }
    endAt.current = null;
  }
  async function stop() {
    generation.current += 1;
    const id = sessionId.current; sessionId.current = null;
    cleanup(); setState("closed"); setWork(null);
    if (id) await fetch(`/api/voice/sessions/${id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
  }
  useEffect(() => () => { void stop(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (endAt.current === null) return;
      const seconds = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000)); setRemainingSeconds(seconds);
      if (!seconds) { void stop(); setError("Your three-minute session ended. You can start another session."); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function recordLine(id: string, speaker: TranscriptLine["speaker"], text: string) {
    if (text.trim()) setTranscript(current => [...current.filter(line => line.id !== id), { id, speaker, text }].slice(-30));
  }

  async function handleMessage(raw: string, channel: RTCDataChannel, attempt: number) {
    if (attempt !== generation.current) return;
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "output_audio_buffer.started") setState("speaking");
    if (event.type === "output_audio_buffer.stopped" || event.type === "input_audio_buffer.speech_started") setState("listening");
    if (event.type === "conversation.item.input_audio_transcription.completed") recordLine(event.item_id, "You", event.transcript ?? "");
    if (event.type === "response.output_audio_transcript.done") recordLine(event.item_id, "PaperTrail", event.transcript ?? "");
    if (event.type === "error") { setError("The voice service reported an error. Stop and start again if needed."); return; }
    if (event.type !== "response.done") return;
    const calls = (event.response?.output ?? []).filter((item: { type: string }) => item.type === "function_call");
    for (const call of calls) {
      if (attempt !== generation.current || !sessionId.current) return;
      setState("working"); setWork(call.name === "prepare_packet" ? "Preparing your private review packet…" : call.name === "analyze_source" ? "Queuing source analysis…" : call.name === "save_application_note" ? "Saving your note for review…" : "Checking the latest application state…");
      let result: unknown = { error: "The action could not be completed. Use the web controls." };
      try {
        const response = await fetch(`/api/voice/sessions/${sessionId.current}/tools`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: call.call_id, name: call.name, arguments: JSON.parse(call.arguments || "{}") }) });
        result = await response.json();
        if (response.ok && call.name !== "get_application_state") router.refresh();
      } catch { /* Send a failure result, never a synthetic success. */ }
      if (attempt !== generation.current || channel.readyState !== "open") return;
      channel.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } }));
    }
    if (calls.length && channel.readyState === "open" && attempt === generation.current) channel.send(JSON.stringify({ type: "response.create" }));
    setWork(null);
  }

  async function start() {
    if (!enabled || connection.current) return;
    const attempt = ++generation.current;
    setError(null); setWork(null); setState("connecting"); setRemainingSeconds(180);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const peer = new RTCPeerConnection(); connection.current = peer;
      media.getTracks().forEach(track => peer.addTrack(track, media));
      peer.ontrack = event => { if (!audio.current) audio.current = new Audio(); audio.current.srcObject = event.streams[0] ?? null; void audio.current.play().catch(() => undefined); };
      peer.onconnectionstatechange = () => { if (attempt === generation.current && ["failed", "disconnected"].includes(peer.connectionState)) { void stop(); setError("Voice disconnected. Your saved work is available below."); } };
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = event => { void handleMessage(String(event.data), channel, attempt); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      const response = await fetch("/api/voice/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId, sdp: offer.sdp }) });
      const result = await response.json();
      if (attempt !== generation.current) { if (result.sessionId) await fetch(`/api/voice/sessions/${result.sessionId}`, { method: "DELETE" }); return; }
      if (!response.ok || !result.sessionId || !result.answerSdp || !result.expiresAt) throw new Error("voice_start_failed");
      sessionId.current = result.sessionId; endAt.current = new Date(result.expiresAt).getTime();
      await peer.setRemoteDescription({ type: "answer", sdp: result.answerSdp }); setState("listening");
    } catch { await stop(); setState("failed"); setError("Voice could not start. Check microphone permission and your OpenAI Realtime access in Settings."); }
  }

  if (!enabled) return <section className="mt-8 border border-[var(--pt-rule)] bg-white p-6" aria-labelledby="voice-title"><h2 className="text-2xl font-bold" id="voice-title">Live voice</h2><p className="mt-3 text-sm leading-6 text-[var(--slate)]">Choose OpenAI in <a className="underline" href="/app/settings">provider settings</a> to talk through this application. You can use the text assistant with either provider.</p></section>;
  const active = ["connecting", "listening", "speaking", "working"].includes(state);
  return <section className="mt-8 border border-[var(--pt-rule)] bg-white p-6" aria-labelledby="voice-title"><h2 className="text-2xl font-bold" id="voice-title">Live voice</h2><p className="mt-2 text-sm leading-6 text-[var(--slate)]">Discuss this application's requirements, ask for packet preparation, or record a correction for review.</p><p className="mt-4 text-sm font-semibold" role="status">{work ?? state}{active ? ` · ${Math.ceil(remainingSeconds / 60)} min remaining` : ""}</p>{error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><button className="min-h-11 bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={active} onClick={() => void start()} type="button">{state === "connecting" ? "Connecting…" : "Start live voice"}</button>{active ? <button className="min-h-11 border border-[var(--pt-rule)] px-5 py-3 font-semibold" onClick={() => void stop()} type="button">Stop voice</button> : null}</div>{transcript.length ? <details className="mt-5"><summary className="cursor-pointer font-semibold">Conversation transcript</summary><ol className="mt-3 grid max-h-72 gap-3 overflow-auto">{transcript.map(line => <li className="text-sm leading-6" key={line.id}><span className="font-semibold">{line.speaker}: </span>{line.text}</li>)}</ol></details> : null}</section>;
}
