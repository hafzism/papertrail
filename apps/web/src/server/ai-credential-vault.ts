import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SupportedAiProvider = "openai" | "gemini";
const version = "v1";

function keyFor(secret: string): Buffer {
  if (secret.trim().length < 16) throw new Error("AI_CREDENTIAL_ENCRYPTION_KEY_UNAVAILABLE");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function resolveAiCredentialEncryptionSecret(environment: NodeJS.ProcessEnv = process.env): string {
  const secret = environment.BYOK_ENCRYPTION_KEY?.trim() || environment.APP_LINK_SIGNING_KEY?.trim() || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret || secret.length < 16) throw new Error("AI_CREDENTIAL_ENCRYPTION_KEY_UNAVAILABLE");
  return secret;
}

export function encryptApiKey(apiKey: string, secret: string): string {
  const value = apiKey.trim();
  if (value.length < 12 || value.length > 4096) throw new Error("AI_CREDENTIAL_INVALID");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptApiKey(ciphertext: string, secret: string): string {
  const [storedVersion, iv, tag, encrypted, ...extra] = ciphertext.split(".");
  if (storedVersion !== version || !iv || !tag || !encrypted || extra.length > 0) throw new Error("AI_CREDENTIAL_CIPHERTEXT_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const value = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
    if (value.length < 12 || value.length > 4096) throw new Error("AI_CREDENTIAL_CIPHERTEXT_INVALID");
    return value;
  } catch (error) { if (error instanceof Error && error.message === "AI_CREDENTIAL_CIPHERTEXT_INVALID") throw error; throw new Error("AI_CREDENTIAL_CIPHERTEXT_INVALID"); }
}
