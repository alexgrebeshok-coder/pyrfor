import { afterEach, describe, expect, it } from "vitest";

import { getServerAIStatus, hasOpenClawGateway } from "@/lib/ai/server-runs";

const gatewayEnvKeys = ["OPENCLAW_GATEWAY_URL", "OPENCLAW_GATEWAY_TOKEN"] as const;

describe("OpenClaw gateway detection", () => {
  const previousValues = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of gatewayEnvKeys) {
      const value = previousValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("treats a local gateway URL as available even without a token", () => {
    for (const key of gatewayEnvKeys) {
      previousValues.set(key, process.env[key]);
      delete process.env[key];
    }

    process.env.OPENCLAW_GATEWAY_URL = "http://127.0.0.1:18789/v1/chat/completions";

    expect(hasOpenClawGateway()).toBe(true);
    expect(getServerAIStatus().gatewayKind).toBe("local");
  });

  it("classifies non-local gateways as remote", () => {
    for (const key of gatewayEnvKeys) {
      previousValues.set(key, process.env[key]);
      delete process.env[key];
    }

    process.env.OPENCLAW_GATEWAY_URL = "https://gateway.example.com/v1/chat/completions";

    expect(hasOpenClawGateway()).toBe(true);
    expect(getServerAIStatus().gatewayKind).toBe("remote");
  });
});
