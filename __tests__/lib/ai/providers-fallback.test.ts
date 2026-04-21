import { describe, expect, it } from "vitest";

import { isTransientProviderError } from "@/lib/ai/providers";

describe("isTransientProviderError", () => {
  it("treats explicit provider-level errors as transient", () => {
    expect(isTransientProviderError(new Error("OpenRouter API error: 429"))).toBe(true);
    expect(isTransientProviderError(new Error("OPENAI_API_KEY not set"))).toBe(true);
    expect(isTransientProviderError(new Error("provider not available"))).toBe(true);
    expect(isTransientProviderError(new Error("all models exhausted"))).toBe(true);
  });

  it("recognises network-layer failures", () => {
    expect(isTransientProviderError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientProviderError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe(true);
    expect(isTransientProviderError(new Error("getaddrinfo ENOTFOUND openrouter.ai"))).toBe(true);
    expect(isTransientProviderError(new Error("getaddrinfo EAI_AGAIN openrouter.ai"))).toBe(true);
    expect(isTransientProviderError(new Error("socket hang up"))).toBe(true);
    expect(isTransientProviderError(new Error("fetch failed"))).toBe(true);
    expect(isTransientProviderError(new Error("Network error: ERR_CONNECTION"))).toBe(true);
  });

  it("recognises timeouts and aborts", () => {
    expect(isTransientProviderError(new Error("Request timeout after 30000ms"))).toBe(true);
    expect(isTransientProviderError(new Error("The user aborted a request"))).toBe(true);
  });

  it("recognises 5xx status codes surfaced in the message", () => {
    expect(isTransientProviderError(new Error("Upstream responded 502 Bad Gateway"))).toBe(true);
    expect(isTransientProviderError(new Error("Unexpected 503 from provider"))).toBe(true);
    expect(isTransientProviderError(new Error("HTTP 504 gateway timeout"))).toBe(true);
  });

  it("honors the `transient: true` marker on error objects", () => {
    const err = Object.assign(new Error("something odd"), { transient: true });
    expect(isTransientProviderError(err)).toBe(true);
  });

  it("does NOT classify plain validation / auth errors as transient", () => {
    expect(isTransientProviderError(new Error("Invalid prompt"))).toBe(false);
    expect(isTransientProviderError(new Error("400 bad request: bad input"))).toBe(false);
    expect(isTransientProviderError(new Error("401 unauthorized"))).toBe(false);
    expect(isTransientProviderError(new Error("403 forbidden"))).toBe(false);
    expect(isTransientProviderError(new Error("404 not found"))).toBe(false);
  });

  it("handles null/undefined/empty inputs safely", () => {
    expect(isTransientProviderError(null)).toBe(false);
    expect(isTransientProviderError(undefined)).toBe(false);
    expect(isTransientProviderError("")).toBe(false);
    expect(isTransientProviderError(new Error(""))).toBe(false);
  });
});
