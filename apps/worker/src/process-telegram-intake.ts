import { createHash } from "node:crypto";
import { generateAssistantReply, transcribeRecordedAudio } from "@papertrail/ai/assistant";
import { validateRecordedAudio } from "@papertrail/ai/audio";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, WorkerRepository, FinishableJobState } from "@papertrail/db";
import { decryptApiKey, resolveAiCredentialEncryptionSecret } from "./ai-credential-vault.js";
import type { JobHandler } from "./durable-worker.js";

interface Media { fileId: string; filename: string; mimeType: string; byteSize: number; kind: "document" | "voice"; duration?: number; }
interface Intake { id: string; body: string; owner_id: string; telegram_chat_id: string | number; application_id: string | null; media: Media | null; finished?: boolean; uncertain?: boolean; }
interface AppOption { id: string; title: string; lifecycle_state: string; }
const maximumBytes = 20 * 1024 * 1024;

export function sniffTelegramDocument(bytes: Uint8Array): { mimeType: string; extension: string } {
  if (Buffer.from(bytes.subarray(0,5)).toString() === "%PDF-") return { mimeType: "application/pdf", extension: "pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mimeType: "image/png", extension: "png" };
  if (Buffer.from(bytes.subarray(0,4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8,12)).toString() === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  throw new Error("Choose a PDF, JPEG, PNG or WebP document.");
}

export async function boundedFileBytes(response: Response, maximum = maximumBytes): Promise<Uint8Array> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > maximum) throw new Error("The file could not be downloaded within the 20 MB limit.");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > maximum) throw new Error("The file exceeds 20 MB. Use the web uploader."); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => undefined); }
  if (!size) throw new Error("The file is empty.");
  return new Uint8Array(Buffer.concat(chunks, size));
}

export class ProcessTelegramIntakeHandler implements JobHandler {
  readonly supportedKinds = ["process_telegram_intake"] as const;
  constructor(private readonly repository: WorkerRepository, private readonly storage: SupabaseClient, private readonly fetchImpl: typeof fetch = fetch) {}

  private async telegram(method: string, body: Record<string, unknown>) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) throw new Error("Telegram bot is not configured.");
    // Never log provider URLs: Telegram embeds the bot token in its path.
    const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const result = await response.json() as { ok?: boolean; result?: Record<string, unknown> };
    if (!response.ok || !result.ok) throw new Error("Telegram could not accept this request.");
    return result.result ?? {};
  }

  async handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }> {
    const intake = await this.repository.telegramIntakeAction<Intake>(job, "begin");
    if (intake.finished) return { state: "succeeded" };
    if (intake.uncertain) return { state: "outcome_unknown", errorCode: "TELEGRAM_PRIOR_INTAKE_UNCERTAIN" };
    let reply: string;
    try { reply = await this.process(job, intake); }
    catch (error) { reply = error instanceof Error ? error.message : "This item could not be processed. Use your web workspace."; }
    // Persist the response before dispatch. Recovery never repeats a possibly sent reply.
    await this.repository.telegramIntakeAction(job, "finish", { reply, state: "uncertain" });
    try {
      await this.telegram("sendMessage", { chat_id: String(intake.telegram_chat_id), text: reply.slice(0,4000), disable_web_page_preview: true });
      await this.repository.telegramIntakeAction(job, "finish", { reply, state: "completed" });
      if (intake.body.trim() === "/unlink") await this.repository.telegramIntakeAction(job, "unlink");
      return { state: "succeeded" };
    } catch {
      if (intake.body.trim() === "/unlink") await this.repository.telegramIntakeAction(job, "unlink").catch(() => undefined);
      return { state: "outcome_unknown", errorCode: "TELEGRAM_REPLY_OUTCOME_UNCERTAIN" };
    }
  }

  private async process(job: ClaimedJob, intake: Intake): Promise<string> {
    const origin = process.env.APP_ORIGIN?.trim() || "http://localhost:3000";
    const text = intake.body.trim();
    const action = <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => this.repository.telegramIntakeAction<T>(job,name,args);
    if (/^\/(help|start)(?:\s|$)/.test(text)) return `PaperTrail uses the same private application and evidence as the web app.\n/applications — list drafts\n/use 1 — select a draft\n/new Title — create one\n/status — current checklist\n/source Text — add a source description\n/packet — prepare review packet\n/settings — web controls\n/unlink — disconnect\n\nAfter selecting a draft, send text, a PDF/image, or a voice note. Corrections and external actions need web review.\n${origin}/app`;
    if (/^\/settings$/.test(text)) return `Manage keys, language and channel links: ${origin}/app/settings`;
    if (/^\/applications$/.test(text) || /^\/use\s/.test(text)) {
      const apps = await action<AppOption[]>("applications");
      const selection = /^\/use\s+(\d+)$/.exec(text);
      if (selection) {
        const app = apps[Number(selection[1])-1];
        if (!app) return "That selection is unavailable. Send /applications for your current list.";
        await action("select", { applicationId: app.id });
        return `Selected: ${app.title}\n${origin}/app/applications/${app.id}\nSend a message or document for this application.`;
      }
      return apps.length ? `Your applications:\n${apps.map((app,index) => `${index+1}. ${app.title} (${app.lifecycle_state})`).join("\n")}\n\nSelect one with /use followed by its number.` : `No applications yet. Send /new followed by a title, or open ${origin}/app/applications/new`;
    }
    if (/^\/new\s+/.test(text)) {
      const app = await action<{ applicationId: string }>("new", { title: text.replace(/^\/new\s+/,"").slice(0,200) });
      return `Private draft created and selected.\n${origin}/app/applications/${app.applicationId}`;
    }
    if (text === "/unlink") return "Your Telegram chat is disconnected. Existing private records remain in the web workspace.";
    if (intake.media) return this.processMedia(job,intake);
    if (!intake.application_id) return `Choose the application first: /applications then /use 1. Your message has been saved for review in Settings.\n${origin}/app/settings`;
    if (/^\/source\s+/.test(text)) { await action("source",{ text: text.replace(/^\/source\s+/,"") }); return `Source description saved for review. It is unverified until reviewed.\n${origin}/app/applications/${intake.application_id}`; }
    if (text === "/packet") { await action("packet"); return `Private packet preparation queued.\n${origin}/app/applications/${intake.application_id}`; }
    const context = await action<Record<string, unknown>>("context");
    const app = context.application as { title?: string };
    if (text === "/status") {
      const requirements = context.requirements as Array<{ label: string; review_state: string }>;
      return `${app.title}\n${requirements.length ? requirements.map(item => `${item.label}: ${item.review_state}`).join("\n") : "No reviewed requirements yet. Add a notice/source in the web workspace."}\n${origin}/app/applications/${intake.application_id}`;
    }
    if (text.startsWith("/")) return "Unknown command. Send /help for the available commands.";
    await action("note",{ text });
    const stored = await this.repository.ownerAiProviderCredential(intake.owner_id);
    if (!stored) return `Saved to ${app.title}. To receive AI assistance, add your OpenAI or Gemini key at ${origin}/app/settings`;
    const answer = await generateAssistantReply({ provider: stored.provider, model: stored.model, apiKey: decryptApiKey(stored.key_ciphertext,resolveAiCredentialEncryptionSecret()) },context,text,this.fetchImpl);
    return `${app.title}\n\n${answer.reply}${answer.correction ? `\n\nProposed correction: ${answer.correction.factKey} = ${String(answer.correction.value)}. Confirm it in the web application.` : ""}\n\n${origin}/app/applications/${intake.application_id}`;
  }

  private async processMedia(job: ClaimedJob, intake: Intake): Promise<string> {
    const media = intake.media!;
    const origin = process.env.APP_ORIGIN?.trim() || "http://localhost:3000";
    if (media.byteSize > maximumBytes) return `This file exceeds 20 MB. Use the web uploader: ${origin}/app/vault`;
    if (media.kind === "voice" && (!Number.isFinite(media.duration) || media.duration! < 1 || media.duration! > 300)) return "Send a voice note up to five minutes long.";
    const file = await this.telegram("getFile", { file_id: media.fileId });
    if (typeof file.file_path !== "string" || !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(file.file_path) || file.file_path.includes("..")) throw new Error("Telegram returned an unsupported file path.");
    const bytes = await boundedFileBytes(await this.fetchImpl(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/${file.file_path}`, { signal: AbortSignal.timeout(30_000), redirect: "error" }));
    if (media.kind === "voice") {
      if (Buffer.from(bytes.subarray(0,4)).toString() !== "OggS") throw new Error("Send a standard Telegram voice note (OGG/Opus).");
      await validateRecordedAudio(bytes,"audio/ogg");
      const stored = await this.repository.ownerAiProviderCredential(intake.owner_id);
      if (!stored) return `Save your OpenAI or Gemini key before sending voice notes: ${origin}/app/settings`;
      const transcript = await transcribeRecordedAudio({ provider: stored.provider, model: stored.model, apiKey: decryptApiKey(stored.key_ciphertext,resolveAiCredentialEncryptionSecret()) },bytes,"audio/ogg","voice.ogg",process.env.MODEL_TRANSCRIBE?.trim() || "gpt-transcribe",this.fetchImpl);
      await this.repository.telegramIntakeAction(job,"transcript",{ text: transcript });
      if (intake.application_id) await this.repository.telegramIntakeAction(job,"note",{ text: `Voice transcript — please review: ${transcript}`.slice(0,4000) });
      return `Voice transcript (please correct any mistakes):\n\n${transcript.slice(0,3000)}\n\n${intake.application_id ? "Saved as a note in your selected application." : "Select an application with /applications to continue."}\n${origin}/app/settings`;
    }
    const { mimeType,extension } = sniffTelegramDocument(bytes);
    const filename = (media.filename || `telegram-document.${extension}`).replace(/[^A-Za-z0-9._-]/g,"_").slice(0,200);
    const objectPath = `telegram/${intake.owner_id}/${intake.id}/${filename}`;
    const { error } = await this.storage.storage.from("private-documents").upload(objectPath,bytes,{ contentType: mimeType, upsert: false });
    if (error) throw new Error("The document could not be stored. Try the web uploader.");
    try { await this.repository.telegramIntakeAction(job,"document",{ objectPath, filename, mimeType, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); }
    catch { await this.storage.storage.from("private-documents").remove([objectPath]); throw new Error("Document intake failed. The unregistered upload was removed."); }
    return `Document received privately. Extraction is queued; extracted facts require your review.\n${origin}/app/vault`;
  }
}
