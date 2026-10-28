import { describe, expect, it } from "vitest";
import { GeminiGenerateContentTransport } from "../src/index.js";

describe("GeminiGenerateContentTransport", () => {
  it("uses a bounded generateContent request and returns text", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toContain("models/gemini-2.5-flash:generateContent");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ responseId: "gemini-response", candidates: [{ content: { parts: [{ text: "[]" }] } }] }), { status: 200 });
    };
    const transport = new GeminiGenerateContentTransport("test-key", fetchImpl);
    await expect(transport.create({ model: "gemini-2.5-flash", instructions: "JSON only", input: "source", maxOutputTokens: 20, metadata: {} })).resolves.toEqual({ id: "gemini-response", outputText: "[]" });
  });
});
