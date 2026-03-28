import { describe, expect, it } from "vitest";

import { buildCostRecorder, calculateCost, estimateTokens } from "@/lib/ai/cost-tracker";

describe("cost-tracker", () => {
  it("estimates tokens and calculates non-zero priced runs", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);

    const cost = calculateCost("openai", "gpt-4o-mini", 1000, 500);
    expect(cost.costUsd).toBeGreaterThan(0);
    expect(cost.provider).toBe("openai");
  });

  it("builds a cost recorder that returns output token estimates", () => {
    const recorder = buildCostRecorder("openai", "gpt-4o-mini", [
      { content: "Summarize project risks" },
    ]);
    const cost = recorder("Here is the summary.");
    expect(cost.outputTokens).toBeGreaterThan(0);
  });
});
