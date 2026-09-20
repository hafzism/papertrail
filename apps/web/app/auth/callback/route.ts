import { NextResponse } from "next/server";
import { createClient } from "../../../src/lib/supabase/server";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code && getPublicSupabaseConfig() !== null) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", "oauth_callback_failed");
  return NextResponse.redirect(loginUrl);
}
