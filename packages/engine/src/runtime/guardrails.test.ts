// @vitest-environment node
/**
 * guardrails.test.ts — tests for Pyrfor Guardrails (permission engine).
 *
 * All tests are node-only. The auditPath JSONL test writes to __fixtures__.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createGuardrails } from './guardrails.js';
import type {
  GuardrailContext,
  GuardrailDecision,
  DecisionKind,
} from './guardrails.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = join(__dir, '__fixtures__', 'guardrails-audit-test.jsonl');

function ctx(
  overrides: Partial<GuardrailContext> & { toolName: string },
): GuardrailContext {
  return {
    agentId: 'agent-1',
    args: {},
    isAutonomous: false,
    ...overrides,
  };
}

afterEach(() => {
  if (existsSync(AUDIT_FILE)) {
    rmSync(AUDIT_FILE);
  }
});

// ── 1. Default tier (no policy, no callback) → deny ──────────────────────────

describe('evaluate — default tier review', () => {
  it('returns denied when no policy and no approvalCallback', async () => {
    const g = createGuardrails({ defaultTier: 'review' });
    const d = await g.evaluate(ctx({ toolName: 'some_tool' }));
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe('deny');
    expect(d.reason).toBe('no approval available');
    expect(d.tier).toBe('review');
    expect(d.decisionId).toBeTruthy();
    expect(d.ts).toBeTruthy();
  });
});

// ── 2. Safe tier → allow ──────────────────────────────────────────────────────

describe('evaluate — safe tier', () => {
  it('allows when policy tier is safe', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'read_file', tier: 'safe' }],
    });
    const d = await g.evaluate(ctx({ toolName: 'read_file' }));
    expect(d.allowed).toBe(true);
    expect(d.kind).toBe('allow');
    expect(d.policyMatched).toBe('read_file');
  });
});

// ── 3. Forbidden tier → deny ──────────────────────────────────────────────────

describe('evaluate — forbidden tier', () => {
  it('denies when policy tier is forbidden', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'delete_all', tier: 'forbidden' }],
    });
    const d = await g.evaluate(ctx({ toolName: 'delete_all' }));
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe('deny');
    expect(d.tier).toBe('forbidden');
  });
});

// ── 4. Review tier, autonomous + autonomousMaxTier='review' → allow ───────────

describe('evaluate — review tier autonomous auto-allow', () => {
  it('allows when isAutonomous and autonomousMaxTier covers review', async () => {
    const g = createGuardrails({
      defaultTier: 'review',
      autonomousMaxTier: 'review',
    });
    const d = await g.evaluate(ctx({ toolName: 'some_tool', isAutonomous: true }));
    expect(d.allowed).toBe(true);
    expect(d.kind).toBe('allow');
    expect(d.reason).toMatch(/autonomous/i);
  });
});

// ── 5. Review tier, autonomous + autonomousMaxTier='safe' → deny (no callback)

describe('evaluate — review tier autonomous below maxTier', () => {
  it('denies when autonomous but autonomousMaxTier < review and no callback', async () => {
    const g = createGuardrails({
      defaultTier: 'review',
      autonomousMaxTier: 'safe', // default
    });
    const d = await g.evaluate(ctx({ toolName: 'some_tool', isAutonomous: true }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('no approval available');
  });
});

// ── 6. Review tier + approvalCallback → calls callback with provisional 'ask' ─

describe('evaluate — review tier with approvalCallback', () => {
  it('invokes approvalCallback with provisional decision having kind=ask', async () => {
    const cb = vi.fn<(c: GuardrailContext, d: GuardrailDecision) => Promise<DecisionKind>>(
      async () => 'allow-once',
    );
    const g = createGuardrails({ defaultTier: 'review', approvalCallback: cb });
    await g.evaluate(ctx({ toolName: 'write_file' }));
    expect(cb).toHaveBeenCalledOnce();
    const [, provisional] = cb.mock.calls[0];
    expect(provisional.kind).toBe('ask');
    expect(provisional.needsApproval).toBe(true);
  });
});

// ── 7. approvalCallback returns 'allow-once' → allowed:true ──────────────────

describe('evaluate — approvalCallback allow-once', () => {
  it('returns allowed:true and kind=allow-once', async () => {
    const g = createGuardrails({
      defaultTier: 'review',
      approvalCallback: async () => 'allow-once',
    });
    const d = await g.evaluate(ctx({ toolName: 'write_file' }));
    expect(d.allowed).toBe(true);
    expect(d.kind).toBe('allow-once');
  });
});

// ── 8. approvalCallback returns 'deny-once' → allowed:false ──────────────────

describe('evaluate — approvalCallback deny-once', () => {
  it('returns allowed:false and kind=deny-once', async () => {
    const g = createGuardrails({
      defaultTier: 'review',
      approvalCallback: async () => 'deny-once',
    });
    const d = await g.evaluate(ctx({ toolName: 'write_file' }));
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe('deny-once');
  });
});

// ── 9. approvalCallback throws → deny + warn logged ──────────────────────────

describe('evaluate — approvalCallback throws', () => {
  it('returns deny and logs warn when callback throws', async () => {
    const warnLogs: string[] = [];
    const g = createGuardrails({
      defaultTier: 'review',
      approvalCallback: async () => {
        throw new Error('oops');
      },
      logger: (level, msg) => {
        if (level === 'warn') warnLogs.push(msg);
      },
    });
    const d = await g.evaluate(ctx({ toolName: 'write_file' }));
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe('deny');
    expect(d.reason).toMatch(/threw/i);
    expect(warnLogs.length).toBeGreaterThan(0);
  });
});

// ── 10. approvalCallback returns invalid kind → deny ─────────────────────────

describe('evaluate — approvalCallback invalid kind', () => {
  it('returns deny when callback returns an unexpected string', async () => {
    const g = createGuardrails({
      defaultTier: 'review',
      approvalCallback: async () => 'maybe' as DecisionKind,
    });
    const d = await g.evaluate(ctx({ toolName: 'write_file' }));
    expect(d.allowed).toBe(false);
    expect(d.kind).toBe('deny');
    expect(d.reason).toMatch(/invalid/i);
  });
});

// ── 11. Restricted tier + autonomous → deny ───────────────────────────────────

describe('evaluate — restricted tier autonomous', () => {
  it('denies when isAutonomous and tier is restricted', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'exec_shell', tier: 'restricted' }],
    });
    const d = await g.evaluate(ctx({ toolName: 'exec_shell', isAutonomous: true }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/restricted in autonomous/i);
  });
});

// ── 12. Restricted tier + non-autonomous + approvalCallback ───────────────────

describe('evaluate — restricted tier non-autonomous calls callback', () => {
  it('invokes approvalCallback for restricted tier when not autonomous', async () => {
    const cb = vi.fn<() => Promise<DecisionKind>>(async () => 'allow-once');
    const g = createGuardrails({
      policies: [{ toolName: 'exec_shell', tier: 'restricted' }],
      approvalCallback: cb,
    });
    const d = await g.evaluate(ctx({ toolName: 'exec_shell', isAutonomous: false }));
    expect(cb).toHaveBeenCalledOnce();
    expect(d.allowed).toBe(true);
    expect(d.kind).toBe('allow-once');
  });
});

// ── 13. Pattern mismatch → fall through to default ───────────────────────────

describe('evaluate — pattern mismatch', () => {
  it('falls through to defaultTier when pattern does not match args', async () => {
    const g = createGuardrails({
      defaultTier: 'safe',
      policies: [
        { toolName: 'write_file', tier: 'forbidden', pattern: /dangerous/ },
      ],
    });
    // args don't contain 'dangerous' → pattern mismatch → defaultTier='safe'
    const d = await g.evaluate(ctx({ toolName: 'write_file', args: { path: '/home/ok' } }));
    expect(d.allowed).toBe(true);
    expect(d.tier).toBe('safe');
    expect(d.policyMatched).toBeUndefined();
  });
});

// ── 14. Pattern match → applies policy ───────────────────────────────────────

describe('evaluate — pattern match', () => {
  it('applies policy tier when pattern matches args', async () => {
    const g = createGuardrails({
      defaultTier: 'safe',
      policies: [
        { toolName: 'write_file', tier: 'forbidden', pattern: /dangerous/ },
      ],
    });
    const d = await g.evaluate(
      ctx({ toolName: 'write_file', args: { path: '/dangerous/path' } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.tier).toBe('forbidden');
    expect(d.policyMatched).toBe('write_file');
  });
});

// ── 15. perAgentOverrides denyList → deny regardless of tier ─────────────────

describe('evaluate — perAgentOverrides denyList', () => {
  it('denies even when tool policy is safe', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'read_file', tier: 'safe' }],
      perAgentOverrides: {
        'restricted-agent': { denyList: ['read_file'] },
      },
    });
    const d = await g.evaluate(ctx({ agentId: 'restricted-agent', toolName: 'read_file' }));
    expect(d.allowed).toBe(false);
    expect(d.tier).toBe('forbidden');
    expect(d.reason).toMatch(/denyList/i);
  });
});

// ── 16. perAgentOverrides allowList → allow regardless of tier ────────────────

describe('evaluate — perAgentOverrides allowList', () => {
  it('allows even when tool policy is forbidden', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'delete_all', tier: 'forbidden' }],
      perAgentOverrides: {
        'super-agent': { allowList: ['delete_all'] },
      },
    });
    const d = await g.evaluate(ctx({ agentId: 'super-agent', toolName: 'delete_all' }));
    expect(d.allowed).toBe(true);
    expect(d.tier).toBe('safe');
    expect(d.reason).toMatch(/allowList/i);
  });
});

// ── 17. approveOnce consumed on next matching evaluate ────────────────────────

describe('approveOnce — consumed on use', () => {
  it('allows the first call and denies the second (token consumed)', async () => {
    const g = createGuardrails({ defaultTier: 'review' });
    g.approveOnce('risky_op');
    const d1 = await g.evaluate(ctx({ toolName: 'risky_op' }));
    expect(d1.allowed).toBe(true);
    expect(d1.kind).toBe('allow-once');

    const d2 = await g.evaluate(ctx({ toolName: 'risky_op' }));
    expect(d2.allowed).toBe(false); // token consumed, back to review→deny
  });
});

// ── 18. approveOnce scoped to agentId only matches that agent ─────────────────

describe('approveOnce — agentId scoping', () => {
  it('only matches the specific agentId', async () => {
    const g = createGuardrails({ defaultTier: 'review' });
    g.approveOnce('risky_op', 'agent-A');

    // Different agent — should NOT consume the token
    const d1 = await g.evaluate(ctx({ agentId: 'agent-B', toolName: 'risky_op' }));
    expect(d1.allowed).toBe(false);

    // Correct agent — token should be consumed here
    const d2 = await g.evaluate(ctx({ agentId: 'agent-A', toolName: 'risky_op' }));
    expect(d2.allowed).toBe(true);
    expect(d2.kind).toBe('allow-once');
  });
});

// ── 19. approveOnce not consumed when policy already allows ───────────────────

describe('approveOnce — not consumed if outcome not changed', () => {
  it('does not consume token when policy is safe (already allowed)', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'read_file', tier: 'safe' }],
    });
    g.approveOnce('read_file');

    // Token should not be consumed — policy already allows
    const d1 = await g.evaluate(ctx({ toolName: 'read_file' }));
    expect(d1.allowed).toBe(true);
    expect(d1.kind).toBe('allow'); // NOT 'allow-once'

    // Remove the policy — token should still be present and consumable
    g.removePolicy('read_file');
    const g2 = createGuardrails({ defaultTier: 'review' });
    // In g, the token is still there for 'read_file'
    const d2 = await g.evaluate(ctx({ toolName: 'read_file' }));
    expect(d2.allowed).toBe(true);
    expect(d2.kind).toBe('allow-once'); // now token dictates
  });
});

// ── 20. denyOnce consumed on next matching evaluate ───────────────────────────

describe('denyOnce — consumed on use', () => {
  it('denies the first call (token consumed) and allows the second via safe policy', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'read_file', tier: 'safe' }],
    });
    g.denyOnce('read_file');

    const d1 = await g.evaluate(ctx({ toolName: 'read_file' }));
    expect(d1.allowed).toBe(false);
    expect(d1.kind).toBe('deny-once');

    // Token consumed — policy safe again
    const d2 = await g.evaluate(ctx({ toolName: 'read_file' }));
    expect(d2.allowed).toBe(true);
    expect(d2.kind).toBe('allow');
  });
});

// ── 21. audit() returns recent entries ───────────────────────────────────────

describe('audit — returns entries', () => {
  it('returns all recorded audit entries', async () => {
    const g = createGuardrails({ policies: [{ toolName: 'tool_a', tier: 'safe' }] });
    await g.evaluate(ctx({ toolName: 'tool_a' }));
    await g.evaluate(ctx({ toolName: 'tool_a' }));
    const entries = await g.audit();
    expect(entries).toHaveLength(2);
    expect(entries[0].toolName).toBe('tool_a');
  });
});

// ── 22. audit({agentId}) filters ─────────────────────────────────────────────

describe('audit — agentId filter', () => {
  it('returns only entries for the specified agentId', async () => {
    const g = createGuardrails({ defaultTier: 'safe' });
    await g.evaluate(ctx({ agentId: 'alice', toolName: 'tool_x' }));
    await g.evaluate(ctx({ agentId: 'bob', toolName: 'tool_x' }));
    const entries = await g.audit({ agentId: 'alice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe('alice');
  });
});

// ── 23. audit({toolName}) filters ────────────────────────────────────────────

describe('audit — toolName filter', () => {
  it('returns only entries for the specified toolName', async () => {
    const g = createGuardrails({ defaultTier: 'safe' });
    await g.evaluate(ctx({ toolName: 'tool_alpha' }));
    await g.evaluate(ctx({ toolName: 'tool_beta' }));
    const entries = await g.audit({ toolName: 'tool_alpha' });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe('tool_alpha');
  });
});

// ── 24. audit({sinceMs}) filters ─────────────────────────────────────────────

describe('audit — sinceMs filter', () => {
  it('returns only entries with ts >= sinceMs', async () => {
    let now = 1_000;
    const g = createGuardrails({ defaultTier: 'safe', clock: () => now });

    now = 1_000;
    await g.evaluate(ctx({ toolName: 'tool_early' }));
    now = 3_000;
    await g.evaluate(ctx({ toolName: 'tool_late' }));

    const entries = await g.audit({ sinceMs: 2_000 });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe('tool_late');
  });
});

// ── 25. audit({limit:0}) → [] ────────────────────────────────────────────────

describe('audit — limit 0', () => {
  it('returns empty array when limit is 0', async () => {
    const g = createGuardrails({ defaultTier: 'safe' });
    await g.evaluate(ctx({ toolName: 'tool_x' }));
    const entries = await g.audit({ limit: 0 });
    expect(entries).toEqual([]);
  });
});

// ── 26. recordOutcome updates audit entry ─────────────────────────────────────

describe('recordOutcome', () => {
  it('sets outcome on the audit entry for the given decisionId', async () => {
    const g = createGuardrails({ defaultTier: 'safe' });
    const d = await g.evaluate(ctx({ toolName: 'tool_x' }));
    g.recordOutcome(d.decisionId, 'invoked');
    const entries = await g.audit();
    const entry = entries.find((e) => e.id === d.decisionId);
    expect(entry?.outcome).toBe('invoked');
  });

  it('sets outcome to skipped', async () => {
    const g = createGuardrails({ defaultTier: 'safe' });
    const d = await g.evaluate(ctx({ toolName: 'tool_y' }));
    g.recordOutcome(d.decisionId, 'skipped');
    const entries = await g.audit();
    const entry = entries.find((e) => e.id === d.decisionId);
    expect(entry?.outcome).toBe('skipped');
  });
});

// ── 27. setPolicy / removePolicy / getPolicies ───────────────────────────────

describe('setPolicy / removePolicy / getPolicies', () => {
  it('adds a policy and returns it in getPolicies', () => {
    const g = createGuardrails();
    g.setPolicy({ toolName: 'my_tool', tier: 'safe', rationale: 'always ok' });
    const policies = g.getPolicies();
    expect(policies).toHaveLength(1);
    expect(policies[0].toolName).toBe('my_tool');
    expect(policies[0].tier).toBe('safe');
  });

  it('overwrites an existing policy on setPolicy', async () => {
    const g = createGuardrails({
      policies: [{ toolName: 'my_tool', tier: 'safe' }],
    });
    g.setPolicy({ toolName: 'my_tool', tier: 'forbidden' });
    const d = await g.evaluate(ctx({ toolName: 'my_tool' }));
    expect(d.allowed).toBe(false);
  });

  it('removes a policy and returns true', () => {
    const g = createGuardrails({
      policies: [{ toolName: 'my_tool', tier: 'safe' }],
    });
    expect(g.removePolicy('my_tool')).toBe(true);
    expect(g.getPolicies()).toHaveLength(0);
  });

  it('returns false when removing a non-existent policy', () => {
    const g = createGuardrails();
    expect(g.removePolicy('ghost_tool')).toBe(false);
  });
});

// ── 28. auditPath — JSONL lines appended per evaluate ────────────────────────

describe('auditPath — JSONL', () => {
  it('appends one JSONL line per evaluate call', async () => {
    const g = createGuardrails({
      defaultTier: 'safe',
      auditPath: AUDIT_FILE,
    });
    await g.evaluate(ctx({ toolName: 'tool_a' }));
    await g.evaluate(ctx({ toolName: 'tool_b' }));
    await g.flush();

    const raw = readFileSync(AUDIT_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].toolName).toBe('tool_a');
    expect(parsed[1].toolName).toBe('tool_b');
  });

  it('appends an outcomeUpdate line after recordOutcome', async () => {
    const g = createGuardrails({
      defaultTier: 'safe',
      auditPath: AUDIT_FILE,
    });
    const d = await g.evaluate(ctx({ toolName: 'tool_x' }));
    g.recordOutcome(d.decisionId, 'invoked');

    const raw = readFileSync(AUDIT_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const update = JSON.parse(lines[1]);
    expect(update.outcomeUpdate).toBe(d.decisionId);
    expect(update.outcome).toBe('invoked');
  });
});
