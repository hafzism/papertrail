import { NextResponse } from "next/server";
import { createClient } from "../../../../../src/lib/supabase/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: stopped } = await supabase.rpc("update_voice_session_state", { p_session_id: id, p_state: "closed", p_error_code: null });
  return NextResponse.json({ stopped: stopped === true }, { headers: { "cache-control": "no-store" } });
}
