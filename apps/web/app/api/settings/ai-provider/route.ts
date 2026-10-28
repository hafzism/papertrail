import { NextResponse } from "next/server";
import { createClient } from "../../../../src/lib/supabase/server";
import { encryptApiKey, resolveAiCredentialEncryptionSecret, type SupportedAiProvider } from "../../../../src/server/ai-credential-vault";

export const runtime = "nodejs";

interface SaveCredentialBody { provider?: unknown; model?: unknown; apiKey?: unknown; }

function validProvider(value: unknown): value is SupportedAiProvider { return value === "openai" || value === "gemini"; }
function validModel(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value); }

export async function POST(request: Request): Promise<NextResponse> {
  let body: SaveCredentialBody;
  try { body = await request.json() as SaveCredentialBody; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!validProvider(body.provider) || !validModel(body.model) || typeof body.apiKey !== "string") return NextResponse.json({ error: "invalid_ai_provider_input" }, { status: 400 });
  let keyCiphertext: string;
  try { keyCiphertext = encryptApiKey(body.apiKey, resolveAiCredentialEncryptionSecret()); } catch { return NextResponse.json({ error: "invalid_api_key" }, { status: 400 }); }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabase.rpc("save_owner_ai_provider_credential", { p_provider: body.provider, p_model: body.model, p_key_ciphertext: keyCiphertext });
  if (error) return NextResponse.json({ error: "ai_provider_save_failed" }, { status: 500 });
  return NextResponse.json({ saved: true }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabase.rpc("remove_owner_ai_provider_credential");
  if (error) return NextResponse.json({ error: "ai_provider_remove_failed" }, { status: 500 });
  return NextResponse.json({ removed: true }, { headers: { "cache-control": "no-store" } });
}
