import assert from "node:assert/strict";

import { parseReflectionScore, runWithReflection } from "@/lib/ai/orchestration/reflection";

async function testParseReflectionScore() {
  const parsed = parseReflectionScore(
    'prefix {"completeness":8,"specificity":7,"actionability":6,"consistency":9,"overall":7.5,"critique":"ok","suggestions":["one",2,"two",""]} suffix'
  );

  assert.ok(parsed);
  assert.deepEqual(parsed?.suggestions, ["one", "two"]);
}

async function testRunWithReflectionUsesRevisionLoop() {
  let callCount = 0;
  const fakeRouter = {
    chat: async () => {
      callCount += 1;
      if (callCount === 1) return "Initial response";
      if (callCount === 2) {
        return JSON.stringify({
          completeness: 4,
          specificity: 4,
          actionability: 4,
          consistency: 8,
          overall: 4.5,
          critique: "Too vague",
          suggestions: ["Add concrete steps"],
        });
      }
      if (callCount === 3) return "Improved response";
      return JSON.stringify({
        completeness: 9,
        specificity: 9,
        actionability: 9,
        consistency: 9,
        overall: 9,
        critique: "",
        suggestions: [],
      });
    },
  };

  const result = await runWithReflection(
    [{ role: "user", content: "Create a detailed project recovery plan." }],
    {
      router: fakeRouter as never,
      maxRounds: 2,
      qualityThreshold: 7.5,
    }
  );

  assert.equal(result.finalResponse, "Improved response");
  assert.equal(result.improved, true);
  assert.ok(result.scores.length >= 1);
}

async function run() {
  await testParseReflectionScore();
  await testRunWithReflectionUsesRevisionLoop();
  console.log("PASS reflection.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
