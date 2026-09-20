"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseConfig } from "./config";

export function createClient() {
  const config = requirePublicSupabaseConfig();
  return createBrowserClient(config.url, config.publishableKey);
}
