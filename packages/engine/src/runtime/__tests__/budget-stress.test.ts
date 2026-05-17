// @vitest-environment node
/**
 * Block D: SI run budget guard + effect-gateway per-call budget dimensions.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLedger } from '../event-ledger';
import { createTokenBudgetController, type TokenBudgetController } from '../token-budget-controller';
import {
  abortRunForBudget,
  assertMetaCriticRunBudget,
  checkRunBudget,
} from '../si-run-budget-guard';
import { createEffectGateway, type EffectRequest } from '../universal/effect-gateway';
import type { ToolCapabilityManifest } from '../universal/tool-registry';

describe('budget stress — Block D1 SI run budget', () => {
  let dir: string;
  let ledger: EventLedger;
  const controllers: TokenBudgetController[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-budget-stress-'));
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await Promise.all(controllers.splice(0).map((controller) => controller.flush()));
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function trackController(controller: TokenBudgetController): TokenBudgetController {
    controllers.push(controller);
    return controller;
  }

  it('aborts immediately when maxCostUsd is zero', () => {
    const controller = trackController(createTokenBudgetController({
      storePath: path.join(dir, 'budget-zero.json'),
      flushDebounceMs: 0,
    }));
    controller.addRule({
      id: 'zero-cap',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0,
      targetId: 'run-zero',
    });

    const result = checkRunBudget(controller, 'run-zero', {
      maxCostUsd: 0,
      preflightEstimate: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget denied/i);
  });

  it('denies second check after tiny budget is consumed', () => {
    const controller = trackController(createTokenBudgetController({
      storePath: path.join(dir, 'budget-tiny.json'),
      flushDebounceMs: 0,
    }));
    controller.addRule({
      id: 'tiny-cap',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0.01,
      targetId: 'run-tiny',
    });
    controller.recordConsumption({
      scope: 'task',
      targetId: 'run-tiny',
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.009,
    });

    const second = checkRunBudget(controller, 'run-tiny', {
      preflightEstimate: { promptTokens: 500, completionTokens: 500, costUsd: 0.005 },
    });
    expect(second.allowed).toBe(false);
    expect(second.reason).toMatch(/budget denied/i);
  });

  it('keeps independent budgets per targetId', () => {
    const controller = trackController(createTokenBudgetController({
      storePath: path.join(dir, 'budget-isolated.json'),
      flushDebounceMs: 0,
    }));
    controller.addRule({
      id: 'run-a-cap',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0.001,
      targetId: 'run-a',
    });
    controller.addRule({
      id: 'run-b-cap',
      scope: 'task',
      window: 'total',
      maxCostUsd: 1,
      targetId: 'run-b',
    });

    const blockedA = checkRunBudget(controller, 'run-a', {
      preflightEstimate: { promptTokens: 8000, completionTokens: 4000, costUsd: 0.05 },
    });
    const allowedB = checkRunBudget(controller, 'run-b', {
      preflightEstimate: { promptTokens: 100, completionTokens: 100, costUsd: 0.01 },
    });

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('records run.blocked on abortRunForBudget', async () => {
    await abortRunForBudget(ledger, 'run-ledger-1', 'budget exhausted');
    const events = await ledger.byRun('run-ledger-1');
    expect(events[0]).toMatchObject({ type: 'run.blocked', reason: 'budget exhausted' });
  });

  it('assertMetaCriticRunBudget writes run.blocked before throwing', async () => {
    const controller = trackController(createTokenBudgetController({
      storePath: path.join(dir, 'budget-assert.json'),
      flushDebounceMs: 0,
    }));
    controller.addRule({
      id: 'hard-zero',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0,
      targetId: 'run-assert',
    });

    await expect(assertMetaCriticRunBudget({
      controller,
      ledger,
      policy: { preflightEstimate: { promptTokens: 100, completionTokens: 100, costUsd: 1 } },
    }, 'run-assert')).rejects.toThrow(/budget denied/i);

    const events = await ledger.byRun('run-assert');
    expect(events.some((e) => e.type === 'run.blocked')).toBe(true);
  });
});

describe('budget stress — effect-gateway per-call budgets', () => {
  const gateway = createEffectGateway();

  function request(overrides: Partial<EffectRequest>): EffectRequest {
    return {
      runId: 'run-1',
      toolName: 'tool-a',
      effect: 'net.out',
      url: 'https://api.example.com/v1/search',
      capability: manifest(),
      ...overrides,
    };
  }

  function manifest(overrides: Partial<ToolCapabilityManifest> = {}): ToolCapabilityManifest {
    return {
      description: 'Test capability',
      triggers: ['test'],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      declaredEffects: ['net.out'],
      requiredTrustTier: 'pending_validation',
      requiredSandboxTier: 'wasm',
      egressAllowlist: ['api.example.com'],
      perCallBudget: { egressKB: 1, wallMs: 1_000, tokensUSD: 0.01 },
      ...overrides,
    };
  }

  it('denies when estimated cost exceeds tokensUSD budget', () => {
    const decision = gateway.authorize(request({
      estimatedCostUsd: 0.05,
    }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cost exceeds/i);
  });

  it('denies when estimated wall time exceeds wallMs budget', () => {
    const decision = gateway.authorize(request({
      estimatedWallMs: 5_000,
    }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/wall time exceeds/i);
  });

  it('allows effects within all per-call budget dimensions', () => {
    const decision = gateway.authorize(request({
      estimatedCostUsd: 0.001,
      estimatedWallMs: 100,
      estimatedEgressBytes: 512,
    }));
    expect(decision.allowed).toBe(true);
  });

  it('denies when estimated egress exceeds egressKB budget', () => {
    const decision = gateway.authorize(request({
      estimatedEgressBytes: 4096,
    }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/egress exceeds/i);
  });
});
