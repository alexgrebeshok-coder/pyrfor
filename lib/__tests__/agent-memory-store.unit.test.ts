import assert from "node:assert/strict";

import { recallShortTerm, storeShortTerm } from "@/lib/ai/memory/agent-memory-store";

async function testShortTermRecallRanksByImportance() {
  const agentId = "memory-test-agent";
  storeShortTerm(agentId, "Project Atlas is blocked by permits", { importance: 0.9 });
  storeShortTerm(agentId, "Project Atlas has a weekly sync", { importance: 0.3 });

  const results = recallShortTerm(agentId, "Atlas permits", { limit: 2 });
  assert.equal(results[0], "Project Atlas is blocked by permits");
}

async function testExpiredEntriesAreFilteredOut() {
  const realNow = Date.now;
  const agentId = "memory-expiry-agent";

  try {
    let current = 1_000_000;
    Date.now = () => current;
    storeShortTerm(agentId, "Old memory", { importance: 0.9 });

    current += 31 * 60 * 1000;
    const results = recallShortTerm(agentId, "Old", { limit: 5 });
    assert.equal(results.length, 0);
  } finally {
    Date.now = realNow;
  }
}

async function run() {
  await testShortTermRecallRanksByImportance();
  await testExpiredEntriesAreFilteredOut();
  console.log("PASS agent-memory-store.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
