import { timingSafeEqual } from "node:crypto";

export interface GatewayConfig {
  readonly port: number;
  readonly gatewaySecret: string;
  readonly allowedDestinationOrigins: ReadonlySet<string>;
  readonly publicOrigin: string;
  readonly display: string;
  readonly vncHost: string;
  readonly vncPort: number;
  readonly maxSessionMinutes: number;
  readonly idleMinutes: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function normalizeOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must contain complete HTTP(S) origins.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP(S).`);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error(`${name} must contain origins only, without paths or credentials.`);
  return url.origin;
}

function configuredOrigins(value: string | undefined, name: string): ReadonlySet<string> {
  const origins = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (origins.length === 0) throw new Error(`${name} is required. List the exact portal origins this local browser may open.`);
  return new Set(origins.map((origin) => normalizeOrigin(origin, name)));
}

/** Reads only process configuration. It never writes secrets or accepts a permissive destination default. */
export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const gatewaySecret = env.BROWSER_GATEWAY_SECRET?.trim();
  if (!gatewaySecret || gatewaySecret.length < 24) throw new Error("BROWSER_GATEWAY_SECRET must be at least 24 characters.");
  const port = positiveInteger(env.BROWSER_GATEWAY_PORT, 3002, "BROWSER_GATEWAY_PORT");
  const publicOrigin = normalizeOrigin(env.BROWSER_GATEWAY_PUBLIC_ORIGIN?.trim() || `http://localhost:${port}`, "BROWSER_GATEWAY_PUBLIC_ORIGIN");
  return {
    port,
    gatewaySecret,
    allowedDestinationOrigins: configuredOrigins(env.BROWSER_ALLOWED_ORIGINS, "BROWSER_ALLOWED_ORIGINS"),
    publicOrigin,
    display: env.DISPLAY?.trim() || ":99",
    vncHost: env.BROWSER_VNC_HOST?.trim() || "127.0.0.1",
    vncPort: positiveInteger(env.BROWSER_VNC_PORT, 5900, "BROWSER_VNC_PORT"),
    maxSessionMinutes: positiveInteger(env.BROWSER_MAX_SESSION_MINUTES, 20, "BROWSER_MAX_SESSION_MINUTES"),
    idleMinutes: positiveInteger(env.BROWSER_IDLE_MINUTES, 3, "BROWSER_IDLE_MINUTES"),
  };
}

export function hasGatewaySecret(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate);
  const configured = Buffer.from(expected);
  return actual.length === configured.length && timingSafeEqual(actual, configured);
}

export function isAllowedDestination(rawUrl: string, allowedOrigins: ReadonlySet<string>): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && allowedOrigins.has(url.origin);
  } catch {
    return false;
  }
}
