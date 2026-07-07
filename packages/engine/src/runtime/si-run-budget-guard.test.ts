// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLedger } from './event-ledger';
import { createTokenBudgetController } from './token-budget-controller';
import {
  abortRunForBudget,
  assertMetaCriticRunBudget,
  checkRunBudget,
} from './si-run-budget-guard';

describe('si-run-budget-guard', () => {
  let dir: string;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-si-budget-'));
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });
  it('denies when controller blocks preflight consumption', () => {
    const controller = createTokenBudgetController({ storePath: path.join(dir, 'budget-a.json'), flushDebounceMs: 0 });
    controller.addRule({
      id: 'si-cap',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0.001,
      targetId: 'run-si-1',
    });

    const result = checkRunBudget(controller, 'run-si-1', {
      preflightEstimate: { promptTokens: 8000, completionTokens: 4000, costUsd: 0.05 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget denied/i);
  });

  it('aborts run via ledger and throws from assertMetaCriticRunBudget', async () => {
    const controller = createTokenBudgetController({ storePath: path.join(dir, 'budget-b.json'), flushDebounceMs: 0 });
    controller.addRule({
      id: 'si-hard',
      scope: 'task',
      window: 'total',
      maxCostUsd: 0,
      targetId: 'run-si-2',
    });

    await expect(assertMetaCriticRunBudget({
      controller,
      ledger,
      policy: { preflightEstimate: { promptTokens: 100, completionTokens: 100, costUsd: 1 } },
    }, 'run-si-2')).rejects.toThrow(/budget denied/i);

    const events = await ledger.byRun('run-si-2');
    expect(events.some((event) => event.type === 'run.blocked')).toBe(true);
  });

  it('records run.blocked on abortRunForBudget', async () => {
    await abortRunForBudget(ledger, 'run-si-3', 'budget exhausted');
    const events = await ledger.byRun('run-si-3');
    expect(events[0]).toMatchObject({ type: 'run.blocked', reason: 'budget exhausted' });
  });
});
