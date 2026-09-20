import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { request } from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

const maxResponseBytes = 1_000_000;
const maxRedirects = 3;

export interface CapturedPublicTextSource {
  finalUrl: string;
  contentType: string;
  text: string;
  sha256: string;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) return false;
  if (/^(fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized)) return false;
  return true;
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function parsePublicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_SOURCE_INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("PUBLIC_SOURCE_INVALID_URL");
  }
  if (isIP(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("PUBLIC_SOURCE_DISALLOWED_HOST");
  }
  return url;
}

async function resolvePublicAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicNetworkAddress(entry.address))) {
    throw new Error("PUBLIC_SOURCE_DISALLOWED_ADDRESS");
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) throw new Error("PUBLIC_SOURCE_DNS_UNAVAILABLE");
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function requestOnce(url: URL, address: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const response = request({
      protocol: "https:",
      hostname: address,
      servername: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        host: url.host,
        accept: "text/html, text/plain;q=0.9",
        "user-agent": "PaperTrailSourceCapture/0.1",
      },
      timeout: 15_000,
    }, resolve);
    response.once("timeout", () => response.destroy(new Error("PUBLIC_SOURCE_TIMEOUT")));
    response.once("error", () => reject(new Error("PUBLIC_SOURCE_FETCH_FAILED")));
    response.end();
  });
}

async function readBoundedBody(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxResponseBytes) {
      response.destroy();
      throw new Error("PUBLIC_SOURCE_RESPONSE_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function fetchPublicTextSource(inputUrl: string): Promise<CapturedPublicTextSource> {
  let url = parsePublicHttpsUrl(inputUrl);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const { address } = await resolvePublicAddress(url);
    const response = await requestOnce(url, address);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      if (!location || redirectCount === maxRedirects) throw new Error("PUBLIC_SOURCE_REDIRECT_REJECTED");
      url = parsePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new Error("PUBLIC_SOURCE_HTTP_STATUS");
    }
    const contentType = (response.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (contentType !== "text/html" && contentType !== "text/plain" && contentType !== "application/xhtml+xml") {
      response.resume();
      throw new Error("PUBLIC_SOURCE_UNSUPPORTED_CONTENT_TYPE");
    }
    const body = await readBoundedBody(response);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(body).replace(/\u0000/g, "").trim();
    if (!text) throw new Error("PUBLIC_SOURCE_EMPTY_RESPONSE");
    return { finalUrl: url.toString(), contentType, text, sha256: createHash("sha256").update(body).digest("hex") };
  }
  throw new Error("PUBLIC_SOURCE_REDIRECT_REJECTED");
}
