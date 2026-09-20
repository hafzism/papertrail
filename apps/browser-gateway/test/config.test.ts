import { describe, expect, it } from "vitest";
import { hasGatewaySecret, isAllowedDestination, loadGatewayConfig } from "../src/config.js";

const baseEnvironment = {
  BROWSER_GATEWAY_SECRET: "test-only-secret-that-is-long-enough",
  BROWSER_ALLOWED_ORIGINS: "https://portal.example.test,https://other.example.test",
  BROWSER_GATEWAY_PUBLIC_ORIGIN: "https://browser.example.test",
};

describe("browser gateway configuration", () => {
  it("requires an exact allowlist and normalizes origins", () => {
    const config = loadGatewayConfig(baseEnvironment);
    expect(config.allowedDestinationOrigins).toEqual(new Set(["https://portal.example.test", "https://other.example.test"]));
    expect(isAllowedDestination("https://portal.example.test/form", config.allowedDestinationOrigins)).toBe(true);
    expect(isAllowedDestination("https://untrusted.example.test/form", config.allowedDestinationOrigins)).toBe(false);
  });

  it("does not accept missing or unequal internal secrets", () => {
    expect(hasGatewaySecret(undefined, baseEnvironment.BROWSER_GATEWAY_SECRET)).toBe(false);
    expect(hasGatewaySecret("different-secret", baseEnvironment.BROWSER_GATEWAY_SECRET)).toBe(false);
    expect(hasGatewaySecret(baseEnvironment.BROWSER_GATEWAY_SECRET, baseEnvironment.BROWSER_GATEWAY_SECRET)).toBe(true);
  });

  it("rejects a permissive empty portal allowlist", () => {
    expect(() => loadGatewayConfig({ ...baseEnvironment, BROWSER_ALLOWED_ORIGINS: "" })).toThrow("BROWSER_ALLOWED_ORIGINS is required");
  });
});
