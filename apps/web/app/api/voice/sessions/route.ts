import { NextResponse } from "next/server";
import { createClient } from "../../../../src/lib/supabase/server";

export const runtime = "nodejs";

interface StartVoiceBody { applicationId?: unknown; sdp?: unknown; }

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "voice_not_configured" }, { status: 503 });
  let body: StartVoiceBody;
  try { body = await request.json() as StartVoiceBody; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.applicationId) || typeof body.sdp !== "string" || body.sdp.length < 1 || body.sdp.length > 100_000) return NextResponse.json({ error: "invalid_voice_offer" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const model = process.env.MODEL_LIVE?.trim() || "gpt-realtime";
  const { data: sessionId, error: createError } = await supabase.rpc("create_voice_session", { p_application_id: body.applicationId, p_model_name: model });
  if (createError || typeof sessionId !== "string") return NextResponse.json({ error: "voice_session_not_created" }, { status: 403 });

  const form = new FormData();
  form.set("sdp", new Blob([body.sdp], { type: "application/sdp" }), "offer.sdp");
  form.set("session", JSON.stringify({ type: "realtime", model, output_modalities: ["audio"], max_output_tokens: 256, instructions: "You are the PaperTrail voice guide. Explain the current private workspace carefully, never claim eligibility or submission, and ask the owner to use the authenticated web review for any external action." }));
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(20_000) });
    const answerSdp = await response.text();
    if (!response.ok || !answerSdp.startsWith("v=")) {
      await supabase.rpc("update_voice_session_state", { p_session_id: sessionId, p_state: "failed", p_error_code: `OPENAI_REALTIME_HTTP_${response.status}` });
      return NextResponse.json({ error: "voice_provider_unavailable" }, { status: 503 });
    }
    await supabase.rpc("update_voice_session_state", { p_session_id: sessionId, p_state: "connected", p_error_code: null });
    return NextResponse.json({ sessionId, answerSdp, expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    await supabase.rpc("update_voice_session_state", { p_session_id: sessionId, p_state: "failed", p_error_code: "OPENAI_REALTIME_NETWORK_FAILURE" });
    return NextResponse.json({ error: "voice_provider_unavailable" }, { status: 503 });
  }
}
