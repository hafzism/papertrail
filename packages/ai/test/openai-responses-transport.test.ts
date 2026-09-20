import { describe, expect, it } from "vitest";
import { OpenAIResponsesTransport } from "../src/index.js";

const request = {
  model: "gpt-5.6-luna",
  input: "Return the check.",
  instructions: "Use exact output.",
  maxOutputTokens: 24,
  metadata: { papertrail_request_id: "request", papertrail_run_id: "run" },
};

describe("OpenAIResponsesTransport", () => {
  it("accepts raw REST output content when the SDK convenience field is absent", async () => {
    const transport = new OpenAIResponsesTransport("test-key", async () => new Response(JSON.stringify({
      id: "resp_1",
      output: [{ type: "message", content: [{ type: "output_text", text: "PAPERTRAIL_OPENAI_SMOKE_OK" }] }],
      usage: { input_tokens: 20, output_tokens: 4, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
    }), { status: 200 }));
    await expect(transport.create(request)).resolves.toMatchObject({
      id: "resp_1",
      outputText: "PAPERTRAIL_OPENAI_SMOKE_OK",
      usage: { inputTokens: 20, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 4 },
    });
  });

  it("rejects a response that has no usable text output", async () => {
    const transport = new OpenAIResponsesTransport("test-key", async () => new Response(JSON.stringify({ id: "resp_1", output: [] }), { status: 200 }));
    await expect(transport.create(request)).rejects.toThrow("OPENAI_RESPONSE_INVALID_SHAPE");
  });
});
