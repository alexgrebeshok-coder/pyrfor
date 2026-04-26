// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolRegistry,
  PermissionEngine,
  registerStandardTools,
  type PermissionContext,
  type ToolSpec,
} from './permission-engine';

// ====== Helpers ==============================================================

function makeCtx(workspaceId = 'ws-1', sessionId = 'sess-1'): PermissionContext {
  return { workspaceId, sessionId };
}

function makeSpec(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: {},
    outputSchema: {},
    sideEffect: 'read',
    defaultPermission: 'auto_allow',
    timeoutMs: 5_000,
    idempotent: true,
    requiresApproval: false,
    ...overrides,
  };
}

function makeRegistry(specs: ToolSpec[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const s of specs) reg.register(s);
  return reg;
}

// ====== ToolRegistry tests ===================================================

describe('ToolRegistry', () => {
  it('registers and retrieves a spec', () => {
    const reg = new ToolRegistry();
    const spec = makeSpec();
    reg.register(spec);
    expect(reg.get('test_tool')).toEqual(spec);
  });

  it('returns undefined for unknown tool', () => {
    const reg = new ToolRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('lists all registered specs', () => {
    const reg = new ToolRegistry();
    reg.register(makeSpec({ name: 'a' }));
    reg.register(makeSpec({ name: 'b' }));
    expect(reg.list().map((s) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('throws on duplicate registration', () => {
    const reg = new ToolRegistry();
    reg.register(makeSpec());
    expect(() => reg.register(makeSpec())).toThrow(/duplicate/i);
  });
});

// ====== Default profile (standard) ==========================================

describe('PermissionEngine — default profile', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      makeRegistry([
        makeSpec({ name: 'auto_tool',    defaultPermission: 'auto_allow' }),
        makeSpec({ name: 'ask_once_tool', defaultPermission: 'ask_once' }),
        makeSpec({ name: 'ask_every',    defaultPermission: 'ask_every_time' }),
        makeSpec({ name: 'deny_tool',    defaultPermission: 'deny' }),
      ]),
    );
  });

  it('auto_allow → allow:true, promptUser:false', async () => {
    const d = await engine.check('auto_tool', makeCtx());
    expect(d.allow).toBe(true);
    expect(d.promptUser).toBe(false);
    expect(d.permissionClass).toBe('auto_allow');
  });

  it('ask_once first call → allow:false, promptUser:true', async () => {
    const d = await engine.check('ask_once_tool', makeCtx());
    expect(d.allow).toBe(false);
    expect(d.promptUser).toBe(true);
  });

  it('ask_every_time → allow:false, promptUser:true', async () => {
    const d = await engine.check('ask_every', makeCtx());
    expect(d.allow).toBe(false);
    expect(d.promptUser).toBe(true);
  });

  it('deny → allow:false, promptUser:false', async () => {
    const d = await engine.check('deny_tool', makeCtx());
    expect(d.allow).toBe(false);
    expect(d.promptUser).toBe(false);
    expect(d.permissionClass).toBe('deny');
  });

  it('unknown tool → allow:false, reason:unknown_tool', async () => {
    const d = await engine.check('ghost', makeCtx());
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('unknown_tool');
    expect(d.promptUser).toBe(false);
  });
});

// ====== ask_once approval lifecycle ==========================================

describe('PermissionEngine — ask_once lifecycle', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      makeRegistry([makeSpec({ name: 'write_tool', sideEffect: 'write', defaultPermission: 'ask_once' })]),
    );
  });

  it('first call prompts', async () => {
    const d = await engine.check('write_tool', makeCtx('ws-a'));
    expect(d.promptUser).toBe(true);
    expect(d.allow).toBe(false);
  });

  it('after recordApproval, allow:true, promptUser:false', async () => {
    engine.recordApproval('ws-a', 'write_tool');
    const d = await engine.check('write_tool', makeCtx('ws-a'));
    expect(d.allow).toBe(true);
    expect(d.promptUser).toBe(false);
  });

  it('approval is scoped per workspace', async () => {
    engine.recordApproval('ws-a', 'write_tool');
    const d = await engine.check('write_tool', makeCtx('ws-b'));
    expect(d.promptUser).toBe(true); // ws-b not approved
  });

  it('revokeApproval restores prompt', async () => {
    engine.recordApproval('ws-a', 'write_tool');
    engine.revokeApproval('ws-a', 'write_tool');
    const d = await engine.check('write_tool', makeCtx('ws-a'));
    expect(d.promptUser).toBe(true);
    expect(d.allow).toBe(false);
  });

  it('exportApprovals reflects recorded state', () => {
    engine.recordApproval('ws-a', 'write_tool');
    const approvals = engine.exportApprovals();
    expect(approvals).toEqual([{ workspaceId: 'ws-a', toolName: 'write_tool' }]);
  });

  it('exportApprovals is empty after revoke', () => {
    engine.recordApproval('ws-a', 'write_tool');
    engine.revokeApproval('ws-a', 'write_tool');
    expect(engine.exportApprovals()).toHaveLength(0);
  });
});

// ====== ask_every_time + grant() =============================================

describe('PermissionEngine — ask_every_time and grant', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      makeRegistry([
        makeSpec({ name: 'always_ask', sideEffect: 'execute', defaultPermission: 'ask_every_time' }),
      ]),
    );
  });

  it('always prompts and denies', async () => {
    const d1 = await engine.check('always_ask', makeCtx());
    expect(d1.allow).toBe(false);
    expect(d1.promptUser).toBe(true);

    // second call — still prompts
    const d2 = await engine.check('always_ask', makeCtx());
    expect(d2.allow).toBe(false);
    expect(d2.promptUser).toBe(true);
  });

  it('grant(oneShot=true) returns allow:true without persisting', async () => {
    const g = engine.grant('always_ask', makeCtx());
    expect(g.allow).toBe(true);
    expect(g.promptUser).toBe(false);
    // next check still prompts
    const d = await engine.check('always_ask', makeCtx());
    expect(d.allow).toBe(false);
  });

  it('grant(oneShot=false) persists approval for ask_once semantics', async () => {
    // ask_every_time tools still prompt every time even after grant(oneShot=false),
    // because the effective class is ask_every_time; grant only matters for ask_once tools.
    // For an ask_once tool:
    const reg = new ToolRegistry();
    reg.register(makeSpec({ name: 'once_tool', sideEffect: 'write', defaultPermission: 'ask_once' }));
    const eng2 = new PermissionEngine(reg);

    eng2.grant('once_tool', makeCtx('ws-x'), false);
    const d = await eng2.check('once_tool', makeCtx('ws-x'));
    expect(d.allow).toBe(true);
    expect(d.promptUser).toBe(false);
  });
});

// ====== strict profile =======================================================

describe('PermissionEngine — strict profile', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      makeRegistry([
        makeSpec({ name: 'w',  sideEffect: 'write',       defaultPermission: 'auto_allow' }),
        makeSpec({ name: 'x',  sideEffect: 'execute',     defaultPermission: 'auto_allow' }),
        makeSpec({ name: 'n',  sideEffect: 'network',     defaultPermission: 'auto_allow' }),
        makeSpec({ name: 'd',  sideEffect: 'destructive', defaultPermission: 'auto_allow' }),
        makeSpec({ name: 'r',  sideEffect: 'read',        defaultPermission: 'auto_allow' }),
      ]),
      { profile: 'strict' },
    );
  });

  it('upgrades write auto_allow → ask_every_time', async () => {
    const d = await engine.check('w', makeCtx());
    expect(d.permissionClass).toBe('ask_every_time');
    expect(d.allow).toBe(false);
    expect(d.promptUser).toBe(true);
  });

  it('upgrades execute auto_allow → ask_every_time', async () => {
    const d = await engine.check('x', makeCtx());
    expect(d.permissionClass).toBe('ask_every_time');
  });

  it('upgrades network auto_allow → ask_every_time', async () => {
    const d = await engine.check('n', makeCtx());
    expect(d.permissionClass).toBe('ask_every_time');
  });

  it('upgrades destructive auto_allow → ask_every_time', async () => {
    const d = await engine.check('d', makeCtx());
    expect(d.permissionClass).toBe('ask_every_time');
  });

  it('does NOT upgrade read auto_allow', async () => {
    const d = await engine.check('r', makeCtx());
    expect(d.permissionClass).toBe('auto_allow');
    expect(d.allow).toBe(true);
  });
});

// ====== autonomous profile ===================================================

describe('PermissionEngine — autonomous profile', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine(
      makeRegistry([
        makeSpec({ name: 'rw', sideEffect: 'read',        defaultPermission: 'ask_once' }),
        makeSpec({ name: 'ww', sideEffect: 'write',       defaultPermission: 'ask_once' }),
        makeSpec({ name: 'xw', sideEffect: 'execute',     defaultPermission: 'ask_once' }),
        makeSpec({ name: 'dw', sideEffect: 'destructive', defaultPermission: 'ask_once' }),
        makeSpec({ name: 'nw', sideEffect: 'network',     defaultPermission: 'ask_once' }),
      ]),
      { profile: 'autonomous' },
    );
  });

  it('downgrades read ask_once → auto_allow', async () => {
    const d = await engine.check('rw', makeCtx());
    expect(d.permissionClass).toBe('auto_allow');
    expect(d.allow).toBe(true);
    expect(d.promptUser).toBe(false);
  });

  it('downgrades write ask_once → auto_allow', async () => {
    const d = await engine.check('ww', makeCtx());
    expect(d.permissionClass).toBe('auto_allow');
    expect(d.allow).toBe(true);
  });

  it('does NOT downgrade execute ask_once', async () => {
    const d = await engine.check('xw', makeCtx());
    expect(d.permissionClass).toBe('ask_once');
    expect(d.promptUser).toBe(true);
  });

  it('does NOT downgrade destructive ask_once', async () => {
    const d = await engine.check('dw', makeCtx());
    expect(d.permissionClass).toBe('ask_once');
    expect(d.promptUser).toBe(true);
  });

  it('does NOT downgrade network ask_once', async () => {
    const d = await engine.check('nw', makeCtx());
    expect(d.permissionClass).toBe('ask_once');
    expect(d.promptUser).toBe(true);
  });
});

// ====== Overrides ============================================================

describe('PermissionEngine — overrides', () => {
  it('override takes highest priority over profile', async () => {
    const reg = makeRegistry([
      makeSpec({ name: 'w', sideEffect: 'write', defaultPermission: 'auto_allow' }),
    ]);
    const engine = new PermissionEngine(reg, {
      profile: 'strict',
      overrides: { w: 'auto_allow' },
    });
    const d = await engine.check('w', makeCtx());
    // strict would normally upgrade write auto_allow → ask_every_time,
    // but override forces auto_allow
    expect(d.permissionClass).toBe('auto_allow');
    expect(d.allow).toBe(true);
  });

  it('override can deny an auto_allow tool', async () => {
    const reg = makeRegistry([makeSpec({ name: 'safe', defaultPermission: 'auto_allow' })]);
    const engine = new PermissionEngine(reg, { overrides: { safe: 'deny' } });
    const d = await engine.check('safe', makeCtx());
    expect(d.allow).toBe(false);
    expect(d.permissionClass).toBe('deny');
  });
});

// ====== registerStandardTools ================================================

describe('registerStandardTools', () => {
  let reg: ToolRegistry;

  beforeEach(() => {
    reg = new ToolRegistry();
    registerStandardTools(reg);
  });

  it('registers exactly 14 tools', () => {
    expect(reg.list()).toHaveLength(14);
  });

  const autoAllowTools = ['read_file', 'list_dir', 'search'];
  for (const name of autoAllowTools) {
    it(`${name} has defaultPermission auto_allow`, () => {
      expect(reg.get(name)?.defaultPermission).toBe('auto_allow');
    });
  }

  const askOnceTools = ['write_file', 'apply_patch', 'run_test', 'create_branch', 'browser_navigate'];
  for (const name of askOnceTools) {
    it(`${name} has defaultPermission ask_once`, () => {
      expect(reg.get(name)?.defaultPermission).toBe('ask_once');
    });
  }

  const askEveryTimeTools = ['shell_exec', 'git_push', 'deploy', 'secrets_access', 'network_write', 'delete_file'];
  for (const name of askEveryTimeTools) {
    it(`${name} has defaultPermission ask_every_time`, () => {
      expect(reg.get(name)?.defaultPermission).toBe('ask_every_time');
    });
  }

  it('read_file is idempotent', () => {
    expect(reg.get('read_file')?.idempotent).toBe(true);
  });

  it('shell_exec has requiresApproval:true', () => {
    expect(reg.get('shell_exec')?.requiresApproval).toBe(true);
  });

  it('secrets_access has auditRedact:["value"]', () => {
    expect(reg.get('secrets_access')?.auditRedact).toEqual(['value']);
  });

  it('delete_file has sideEffect:destructive', () => {
    expect(reg.get('delete_file')?.sideEffect).toBe('destructive');
  });

  it('throws if registerStandardTools is called twice on the same registry', () => {
    expect(() => registerStandardTools(reg)).toThrow(/duplicate/i);
  });
});
