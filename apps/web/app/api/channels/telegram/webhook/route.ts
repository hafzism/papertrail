import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string; username?: string };
    from?: { username?: string };
  };
}

function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
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
  const { error } = await supabase.rpc(startMatch ? "ingest_telegram_start_update" : "ingest_telegram_private_text_update", startMatch ? {
    p_update_id: updateId,
    p_chat_id: chat.id,
    p_chat_type: chat.type,
    p_username: update.message?.from?.username ?? chat.username ?? null,
    p_start_token: startMatch?.[1] ?? null,
  } : {
    p_update_id: updateId,
    p_chat_id: chat.id,
    p_chat_type: chat.type,
    p_username: update.message?.from?.username ?? chat.username ?? null,
    p_text: text,
  });
  if (error) return NextResponse.json({ error: "ingest_failed" }, { status: 503 });
  return NextResponse.json({ accepted: true });
}
