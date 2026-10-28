export interface ProviderTextRequest {
  model: string;
  input: string;
  instructions: string;
  maxOutputTokens: number;
  metadata: Record<string, string>;
}

export interface ProviderTextResponse { id: string; outputText: string; }

const modelPattern = /^[A-Za-z0-9._-]{1,120}$/;

/** Minimal non-streaming Gemini transport for owner-supplied keys. */
export class GeminiGenerateContentTransport {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async create(request: ProviderTextRequest): Promise<ProviderTextResponse> {
    if (!modelPattern.test(request.model)) throw new Error("GEMINI_MODEL_INVALID");
    const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.instructions }] },
        contents: [{ role: "user", parts: [{ text: request.input }] }],
        generationConfig: { maxOutputTokens: request.maxOutputTokens, responseMimeType: "application/json" },
      }),
    });
    if (!response.ok) throw new Error(`GEMINI_GENERATE_CONTENT_HTTP_${response.status}`);
    const body = await response.json() as { responseId?: unknown; candidates?: unknown };
    const outputText = extractText(body.candidates);
    if (outputText === null) throw new Error("GEMINI_RESPONSE_INVALID_SHAPE");
    return { id: typeof body.responseId === "string" ? body.responseId : crypto.randomUUID(), outputText };
  }
}

function extractText(candidates: unknown): string | null {
  if (!Array.isArray(candidates)) return null;
  const parts: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const content = (candidate as { content?: unknown }).content;
    if (typeof content !== "object" || content === null) continue;
    const candidateParts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(candidateParts)) continue;
    for (const part of candidateParts) {
      if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") parts.push((part as { text: string }).text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return null;
}
