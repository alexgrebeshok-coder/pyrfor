import assert from "node:assert/strict";

import { CircuitBreaker, CircuitOpenError } from "@/lib/ai/circuit-breaker";

async function testOpensAfterFailures() {
  const breaker = new CircuitBreaker("test-open", {
    failureThreshold: 2,
    resetTimeout: 10,
    halfOpenMax: 1,
    executionTimeoutMs: 50,
  });

  await assert.rejects(() => breaker.execute(async () => {
    throw new Error("boom-1");
  }));
  await assert.rejects(() => breaker.execute(async () => {
    throw new Error("boom-2");
  }));

  await assert.rejects(
    () => breaker.execute(async () => "never"),
    (error: unknown) => error instanceof CircuitOpenError
  );
}

async function testTimesOutExecution() {
  const breaker = new CircuitBreaker("test-timeout", {
    failureThreshold: 1,
    resetTimeout: 10,
    halfOpenMax: 1,
    executionTimeoutMs: 20,
  });

  await assert.rejects(
    () => breaker.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "late";
    }),
    /Circuit timeout/
  );
}

async function testHalfOpenAllowsSingleProbe() {
  const breaker = new CircuitBreaker("test-half-open", {
    failureThreshold: 1,
    resetTimeout: 1,
    halfOpenMax: 1,
    executionTimeoutMs: 50,
  });

  await assert.rejects(() => breaker.execute(async () => {
    throw new Error("fail");
  }));
  await new Promise((resolve) => setTimeout(resolve, 5));

  let releaseProbe!: () => void;
  const probe = breaker.execute(async () => {
    await new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    return "ok";
  });

  await assert.rejects(
    () => breaker.execute(async () => "second-probe"),
    (error: unknown) => error instanceof CircuitOpenError
  );

  releaseProbe();
  assert.equal(await probe, "ok");
}

async function run() {
  await testOpensAfterFailures();
  await testTimesOutExecution();
  await testHalfOpenAllowsSingleProbe();
  console.log("PASS circuit-breaker.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
