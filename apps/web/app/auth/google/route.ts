import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "../../../src/lib/supabase/config";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost && (forwardedProto === "http" || forwardedProto === "https")) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

/**
 * Starts OAuth on the server so the PKCE verifier is stored in the response
 * cookie before the browser leaves PaperTrail. This keeps sign-in usable when
 * a development tunnel cannot maintain Next's client-side HMR connection.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getPublicSupabaseConfig();
  const origin = publicOrigin(request);
  const fallback = new URL("/login", origin);
  fallback.searchParams.set("error", "oauth_start_failed");
  if (config === null) return NextResponse.redirect(fallback);

  const response = NextResponse.redirect(fallback);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeNext(request.nextUrl.searchParams.get("next")));
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(values) {
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) return response;
  response.headers.set("location", data.url);
  return response;
}
