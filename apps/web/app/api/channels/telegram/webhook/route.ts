import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    caption?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    voice?: { file_id: string; mime_type?: string; file_size?: number; duration?: number };
    photo?: Array<{ file_id: string; file_size?: number }>;
    chat?: { id?: number; type?: string; username?: string };
    from?: { username?: string };
  };
}

function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual || Buffer.byteLength(actual) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret || !url || !serviceRole) return NextResponse.json({ error: "telegram_not_configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let update: TelegramUpdate;
  try { update = await request.json() as TelegramUpdate; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const updateId = update.update_id;
  const chat = update.message?.chat;
  if (!Number.isSafeInteger(updateId) || !chat || !Number.isSafeInteger(chat.id) || typeof chat.type !== "string") return NextResponse.json({ accepted: true });
  const text = update.message?.text ?? null;
  const startMatch = text?.match(/^\/start(?:\s+([A-Fa-f0-9]{32,128}))?\s*$/);
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const message = update.message!;
  const attachment = message.document ?? message.voice ?? message.photo?.at(-1);
  const media = attachment ? {
    fileId: attachment.file_id,
    filename: message.document?.file_name ?? (message.voice ? "voice.ogg" : "photo.jpg"),
    mimeType: message.document?.mime_type ?? message.voice?.mime_type ?? "image/jpeg",
    byteSize: attachment.file_size ?? 0,
    kind: message.voice ? "voice" : "document",
    ...(message.voice ? { duration: message.voice.duration } : {}),
  } : null;
  const { data: outcome, error } = await supabase.rpc(startMatch ? "ingest_telegram_start_update" : "queue_telegram_intake", startMatch ? {
    p_update_id: updateId,
    p_chat_id: chat.id,
    p_chat_type: chat.type,
    p_username: update.message?.from?.username ?? chat.username ?? null,
    p_start_token: startMatch?.[1] ?? null,
  } : {
    p_update_id: updateId,
    p_chat_id: chat.id,
    p_chat_type: chat.type,
    p_body: text ?? message.caption ?? "",
    p_media: media,
  });
  if (error) return NextResponse.json({ error: "ingest_failed" }, { status: 503 });
  const origin = process.env.APP_ORIGIN?.trim();
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const reply = outcome === "pending_confirmation" ? `Return to PaperTrail Settings and confirm this private chat: ${origin}/app/settings`
    : outcome === "unlinked" || startMatch && outcome === "ignored" ? `Link your private chat from PaperTrail Settings: ${origin}/app/settings`
    : outcome === "invalid_token" ? `That link expired or has already been used. Create a fresh link: ${origin}/app/settings` : null;
  if (reply && botToken && origin && chat.type === "private") {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat.id, text: reply, disable_web_page_preview: true }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
  return NextResponse.json({ accepted: true });
}
