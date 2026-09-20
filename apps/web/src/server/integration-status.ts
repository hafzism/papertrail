import { getPublicSupabaseConfig } from "../lib/supabase/config";

export type IntegrationState = "not_configured" | "configured_unverified";

export interface IntegrationStatus {
  supabase: IntegrationState;
  openai: IntegrationState;
  telegram: IntegrationState;
  liveVoice: IntegrationState;
  browserExecution: IntegrationState;
}

function isConfigured(...values: Array<string | undefined>): boolean {
  return values.every((value) => Boolean(value?.trim()));
}

export function getIntegrationStatus(): IntegrationStatus {
  return {
    supabase: getPublicSupabaseConfig() === null ? "not_configured" : "configured_unverified",
    openai: isConfigured(process.env.OPENAI_API_KEY)
      ? "configured_unverified"
      : "not_configured",
    telegram: isConfigured(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, process.env.TELEGRAM_BOT_USERNAME)
      ? "configured_unverified"
      : "not_configured",
    liveVoice: isConfigured(process.env.OPENAI_API_KEY, process.env.MODEL_LIVE)
      ? "configured_unverified"
      : "not_configured",
    browserExecution: isConfigured(process.env.BROWSER_PROVIDER, process.env.BROWSER_GATEWAY_INTERNAL_URL, process.env.BROWSER_GATEWAY_SECRET)
      ? "configured_unverified"
      : "not_configured",
  };
}
