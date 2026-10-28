import { createClient as createServiceClient } from "@supabase/supabase-js";
import { generateAssistantReply } from "@papertrail/ai/assistant";
import { NextResponse } from "next/server";
import { createClient } from "../../../../../src/lib/supabase/server";
import { getOwnerAiProviderCredential } from "../../../../../src/server/ai-provider-credentials";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { message?: unknown; requestId?: unknown } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000 || typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  const { data: context, error } = await supabase.rpc("application_assistant_context", { p_application_id: id });
  if (error || !context) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
  let credential;
  try { credential = await getOwnerAiProviderCredential(claims.claims.sub); } catch { return NextResponse.json({ error: "provider_unavailable" }, { status: 503 }); }
  if (!credential) return NextResponse.json({ error: "save_provider_in_settings" }, { status: 409 });
  const { data: turn, error: beginError } = await supabase.rpc("begin_application_assistant_turn", { p_application_id: id, p_message: body.message.trim(), p_request_id: body.requestId });
  if (beginError || !turn) return NextResponse.json({ error: "assistant_busy" }, { status: 409 });
  if (turn.state !== "pending") return NextResponse.json({ reply: turn.reply, state: turn.state, turnId: turn.id }, { status: turn.state === "running" ? 409 : 200 });
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: claimed } = await service.rpc("claim_application_assistant_turn", { p_owner_id: claims.claims.sub, p_turn_id: turn.id });
  if (!claimed) return NextResponse.json({ error: "assistant_busy" }, { status: 409 });
  try {
    const { data: freshContext, error: freshError } = await supabase.rpc("application_assistant_context", { p_application_id: id });
    if (freshError || freshContext?.application?.materialVersion !== turn.material_version) return NextResponse.json({ error: "application_changed_retry" }, { status: 409 });
    const result = await generateAssistantReply(credential, freshContext, body.message);
    const { data: state, error: finishError } = await service.rpc("finish_application_assistant_turn", { p_owner_id: claims.claims.sub, p_turn_id: turn.id, p_reply: result.reply });
    if (finishError || state !== "completed") return NextResponse.json({ error: "application_changed_retry", state }, { status: 409 });
    return NextResponse.json({ ...result, state, turnId: turn.id }, { headers: { "cache-control": "no-store" } });
  } catch {
    await service.rpc("finish_application_assistant_turn", { p_owner_id: claims.claims.sub, p_turn_id: turn.id, p_reply: "The provider could not answer. You can retry explicitly.", p_failed: true });
    return NextResponse.json({ error: "assistant_provider_failed" }, { status: 502 });
  }
}
