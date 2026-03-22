import assert from "node:assert/strict";

import {
  buildRiskApiPayload,
  scoreToRiskLevel,
} from "../risks/risk-form";

assert.equal(scoreToRiskLevel(1), "low");
assert.equal(scoreToRiskLevel(2), "low");
assert.equal(scoreToRiskLevel(3), "medium");
assert.equal(scoreToRiskLevel(4), "medium");
assert.equal(scoreToRiskLevel(5), "high");

assert.deepEqual(
  buildRiskApiPayload({
    title: "Integration delay",
    description: "Vendor is late",
    projectId: "project-1",
    probability: 4,
    impact: 5,
    status: "mitigating",
  }),
  {
    title: "Integration delay",
    description: "Vendor is late",
    projectId: "project-1",
    probability: "medium",
    impact: "high",
    status: "mitigating",
  }
);

console.log("PASS risk-form.unit");
