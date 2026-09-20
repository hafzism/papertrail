import type { ResponsesTransport } from "./metered-responses.js";
import type { TokenUsage } from "./rates.js";

/** A server-only, non-retrying Responses transport. API keys never enter browser code. */
export class OpenAIResponsesTransport implements ResponsesTransport {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async create(request: Parameters<ResponsesTransport["create"]>[0]): Promise<Awaited<ReturnType<ResponsesTransport["create"]>>> {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        max_output_tokens: request.maxOutputTokens,
        metadata: request.metadata,
        store: false,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Responses request failed with HTTP ${response.status}.`);
    const body = (await response.json()) as {
      id?: unknown;
      output_text?: unknown;
      output?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown } };
    };
    const outputText = extractOutputText(body.output_text, body.output);
    if (typeof body.id !== "string" || outputText === null) throw new Error("OPENAI_RESPONSE_INVALID_SHAPE");
    const usage = parseUsage(body.usage);
    return { id: body.id, outputText, ...(usage === undefined ? {} : { usage }) };
  }
}

function extractOutputText(convenienceText: unknown, output: unknown): string | null {
  if (typeof convenienceText === "string") return convenienceText;
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { type?: unknown; text?: unknown }).text;
      if ((part as { type?: unknown }).type === "output_text" && typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function parseUsage(value: unknown): TokenUsage | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const usage = value as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown } };
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens;
  // Exact settlement needs every priced category. A provider payload without cache-write
  // information remains charge_uncertain rather than guessed from text length.
  if (![input, output, cached, cacheWrite].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) return undefined;
  return { inputTokens: input as number, outputTokens: output as number, cachedInputTokens: cached as number, cacheWriteTokens: cacheWrite as number };
}
