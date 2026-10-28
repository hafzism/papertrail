import { NextResponse } from "next/server";
import { createClient } from "../../../../../../src/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { taskId?: string; name?: string; arguments?: Record<string, unknown> } | null;
  if (!body || typeof body.taskId !== "string" || body.taskId.length > 160 || !["get_application_state", "prepare_packet", "analyze_source", "save_application_note"].includes(body.name ?? "")) return NextResponse.json({ error: "invalid_tool" }, { status: 400 });
  const { data, error } = await supabase.rpc("run_voice_application_tool", { p_session_id: id, p_task_id: body.taskId, p_tool: body.name, p_arguments: body.arguments ?? {} });
  return error ? NextResponse.json({ error: "voice_action_needs_review" }, { status: 409 }) : NextResponse.json({ result: data }, { headers: { "cache-control": "no-store" } });
}
