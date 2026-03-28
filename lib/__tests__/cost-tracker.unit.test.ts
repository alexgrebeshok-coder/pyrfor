import assert from "node:assert/strict";

import { buildCostRecorder, calculateCost, estimateTokens } from "@/lib/ai/cost-tracker";

async function testEstimateTokensProducesNonZeroValue() {
  assert.ok(estimateTokens("hello world") > 0);
}

async function testCalculateCostRespectsPricingTable() {
  const cost = calculateCost("openai", "gpt-4o-mini", 1000, 500);
  assert.ok(cost.costUsd > 0);
  assert.equal(cost.provider, "openai");
}

async function testBuildCostRecorderReturnsCost() {
  const recorder = buildCostRecorder("openai", "gpt-4o-mini", [
    { content: "Summarize project risks" },
  ]);
  const cost = recorder("Here is the summary.");
  assert.ok(cost.outputTokens > 0);
}

async function run() {
  await testEstimateTokensProducesNonZeroValue();
  await testCalculateCostRespectsPricingTable();
  await testBuildCostRecorderReturnsCost();
  console.log("PASS cost-tracker.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
