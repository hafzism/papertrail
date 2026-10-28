import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "../lib/supabase/config";
import { decryptApiKey, resolveAiCredentialEncryptionSecret, type SupportedAiProvider } from "./ai-credential-vault";

export interface OwnerAiProviderCredential {
  provider: SupportedAiProvider;
  model: string;
  apiKey: string;
}

function isProvider(value: unknown): value is SupportedAiProvider {
  return value === "openai" || value === "gemini";
}

/** Trusted server-only credential lookup. It never returns a key to a React component. */
export async function getOwnerAiProviderCredential(ownerId: string): Promise<OwnerAiProviderCredential | null> {
  const config = getPublicSupabaseConfig();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (config === null || !serviceRole) return null;
  const admin = createSupabaseClient(config.url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc("get_owner_ai_provider_credential_for_service", { p_owner_id: ownerId });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { provider?: unknown; model?: unknown; key_ciphertext?: unknown };
  if (!isProvider(row.provider) || typeof row.model !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(row.model) || typeof row.key_ciphertext !== "string") return null;
  return { provider: row.provider, model: row.model, apiKey: decryptApiKey(row.key_ciphertext, resolveAiCredentialEncryptionSecret()) };
}
