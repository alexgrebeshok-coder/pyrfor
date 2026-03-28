import { describe, expect, it } from "vitest";

import { CircuitBreaker, CircuitOpenError } from "@/lib/ai/circuit-breaker";

describe("circuit-breaker", () => {
  it("opens after the configured number of failures", async () => {
    const breaker = new CircuitBreaker("vitest-open", {
      failureThreshold: 2,
      resetTimeout: 10,
      halfOpenMax: 1,
      executionTimeoutMs: 50,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error("first");
      })
    ).rejects.toThrow("first");

    await expect(
      breaker.execute(async () => {
        throw new Error("second");
      })
    ).rejects.toThrow("second");

    await expect(breaker.execute(async () => "never")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("times out slow executions", async () => {
    const breaker = new CircuitBreaker("vitest-timeout", {
      failureThreshold: 1,
      resetTimeout: 10,
      halfOpenMax: 1,
      executionTimeoutMs: 20,
    });

    await expect(
      breaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return "late";
      })
    ).rejects.toThrow(/Circuit timeout/);
  });
});
