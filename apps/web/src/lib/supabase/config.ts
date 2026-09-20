export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

/** Supports the legacy anon-key name during the project setup transition. */
export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function requirePublicSupabaseConfig(): PublicSupabaseConfig {
  const config = getPublicSupabaseConfig();
  if (config === null) throw new Error("Supabase public configuration is missing.");
  return config;
}
