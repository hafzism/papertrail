export interface ModelRate {
  inputNanoPerToken: bigint;
  cachedInputNanoPerToken: bigint;
  cacheWriteNanoPerToken: bigint;
  outputNanoPerToken: bigint;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}.`);
}

export function assertUsageIsCountable(usage: TokenUsage): void {
  nonNegativeInteger(usage.inputTokens, "input token count");
  nonNegativeInteger(usage.cachedInputTokens, "cached input token count");
  nonNegativeInteger(usage.cacheWriteTokens, "cache-write token count");
  nonNegativeInteger(usage.outputTokens, "output token count");
  if (usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens) {
    throw new Error("Input token categories exceed total input tokens.");
  }
}

export function calculateUsageNano(usage: TokenUsage, rate: ModelRate): bigint {
  assertUsageIsCountable(usage);
  const uncached = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  return (
    BigInt(uncached) * rate.inputNanoPerToken +
    BigInt(usage.cachedInputTokens) * rate.cachedInputNanoPerToken +
    BigInt(usage.cacheWriteTokens) * rate.cacheWriteNanoPerToken +
    BigInt(usage.outputTokens) * rate.outputNanoPerToken
  );
}

export function reserveWorstCaseNano(inputTokens: number, maxOutputTokens: number, rate: ModelRate): bigint {
  nonNegativeInteger(inputTokens, "counted input tokens");
  nonNegativeInteger(maxOutputTokens, "maximum output tokens");
  const maxInputRate = rate.inputNanoPerToken > rate.cacheWriteNanoPerToken ? rate.inputNanoPerToken : rate.cacheWriteNanoPerToken;
  return BigInt(inputTokens) * maxInputRate + BigInt(maxOutputTokens) * rate.outputNanoPerToken;
}

