import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  applyServerAIProposal,
  createServerAIRun,
  getServerAIRun,
} from "@/lib/ai/server-runs";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/server/runtime-mode";

import { createWorkReportSignalFixtureBundle } from "./fixtures/work-report-signal-fixtures";

const cacheDir = path.join(process.cwd(), ".ceoclaw-cache", "ai-runs");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const aiEnvKeys = [
  "SEOCLAW_AI_MODE",
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_TOKEN",
  "AIJORA_API_KEY",
  "POLZA_API_KEY",
  "OPENROUTER_API_KEY",
  "BOTHUB_API_KEY",
  "ZAI_API_KEY",
  "OPENAI_API_KEY",
] as const;

async function cleanup(runId?: string) {
  if (!runId) return;
  await rm(path.join(cacheDir, `${runId}.json`), { force: true });
  if (isDatabaseConfigured()) {
    await prisma.aiRunLedger.deleteMany({
      where: { id: runId },
    });
  }
}

async function testProductionFailsClosedWithoutAIProviders() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousValues = new Map<string, string | undefined>();

  for (const key of aiEnvKeys) {
    previousValues.set(key, process.env[key]);
    delete process.env[key];
  }

  process.env.NODE_ENV = "production";

  try {
    const { blueprints } = createWorkReportSignalFixtureBundle();
    const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

    assert.ok(input);

    await assert.rejects(
      () => createServerAIRun(input),
      /No live AI provider is configured|Mock AI mode is disabled in production|OpenClaw gateway is not configured/
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    for (const key of aiEnvKeys) {
      const value = previousValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function testMockApplyPersistsToSubsequentReads() {
  const previousMode = process.env.SEOCLAW_AI_MODE;
  process.env.SEOCLAW_AI_MODE = "mock";

  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

  assert.ok(input);

  await mkdir(cacheDir, { recursive: true });

  let runId: string | undefined;

  try {
    const run = await createServerAIRun(input);
    runId = run.id;
    let proposalId = run.result?.proposal?.id;

    for (let attempt = 0; !proposalId && attempt < 8; attempt += 1) {
      await sleep(300);
      const polled = await getServerAIRun(runId);
      proposalId = polled.result?.proposal?.id;
    }

    assert.ok(proposalId);

    await applyServerAIProposal({
      runId,
      proposalId,
    });

    const persisted = await getServerAIRun(runId);

    assert.equal(persisted.result?.proposal?.state, "applied");
    assert.equal(persisted.result?.actionResult?.safety.postApplyState, "guarded_execution");
    assert.equal(persisted.result?.actionResult?.safety.compensationMode, "follow_up_patch");
  } finally {
    await cleanup(runId);
    if (previousMode === undefined) {
      delete process.env.SEOCLAW_AI_MODE;
    } else {
      process.env.SEOCLAW_AI_MODE = previousMode;
    }
  }
}

async function main() {
  await testProductionFailsClosedWithoutAIProviders();
  await testMockApplyPersistsToSubsequentReads();
  console.log("PASS server-airuns.unit");
}

void main();
