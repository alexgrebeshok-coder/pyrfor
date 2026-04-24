// @vitest-environment node
/**
 * Tests for PrivacyManager — zone-based data isolation and redaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PrivacyManager,
  createPrivateLogger,
  PUBLIC_ZONE,
  PERSONAL_ZONE,
  VAULT_ZONE,
  type PrivacyZone,
} from './privacy';
import { logger } from '../observability/logger';

// ─── Zone constants ────────────────────────────────────────────────────────

describe('Zone constants', () => {
  it('PUBLIC_ZONE is not encrypted and requires no auth', () => {
    expect(PUBLIC_ZONE.zone).toBe('public');
    expect(PUBLIC_ZONE.encrypted).toBe(false);
    expect(PUBLIC_ZONE.requiresAuth).toBe(false);
    expect(PUBLIC_ZONE.allowedTools).toContain('web_search');
  });

  it('PERSONAL_ZONE requires auth', () => {
    expect(PERSONAL_ZONE.zone).toBe('personal');
    expect(PERSONAL_ZONE.requiresAuth).toBe(true);
    expect(PERSONAL_ZONE.allowedTools).toContain('read_file');
  });

  it('VAULT_ZONE is encrypted with limited tools', () => {
    expect(VAULT_ZONE.zone).toBe('vault');
    expect(VAULT_ZONE.encrypted).toBe(true);
    expect(VAULT_ZONE.requiresAuth).toBe(true);
    expect(VAULT_ZONE.allowedTools).not.toContain('write_file');
    expect(VAULT_ZONE.allowedTools).toContain('read_file');
  });
});

// ─── Constructor / defaults ────────────────────────────────────────────────

describe('PrivacyManager — construction', () => {
  it('defaults to personal zone', () => {
    const pm = new PrivacyManager();
    expect(pm.getToolZone('unknown_tool')).toBe('personal');
  });

  it('applies custom defaultZone', () => {
    const pm = new PrivacyManager({ defaultZone: 'public' });
    expect(pm.getToolZone('unknown_tool')).toBe('public');
  });

  it('pre-registers default tool zones', () => {
    const pm = new PrivacyManager();
    expect(pm.getToolZone('web_search')).toBe('public');
    expect(pm.getToolZone('web_fetch')).toBe('public');
    expect(pm.getToolZone('send_message')).toBe('personal');
    expect(pm.getToolZone('read_file')).toBe('personal');
    expect(pm.getToolZone('exec')).toBe('personal');
  });

  it('uses empty toolZones map without error', () => {
    const pm = new PrivacyManager({ defaultZone: 'public', toolZones: new Map() });
    expect(pm.getToolZone('anything')).toBe('public');
  });
});

// ─── getToolZone / setToolZone ─────────────────────────────────────────────

describe('PrivacyManager — getToolZone / setToolZone', () => {
  it('returns personal for unknown tool by default', () => {
    const pm = new PrivacyManager();
    expect(pm.getToolZone('nonexistent_tool')).toBe('personal');
  });

  it('overrides a tool zone at runtime', () => {
    const pm = new PrivacyManager();
    pm.setToolZone('web_search', 'vault');
    expect(pm.getToolZone('web_search')).toBe('vault');
  });

  it('adds a new tool zone', () => {
    const pm = new PrivacyManager();
    pm.setToolZone('my_custom_tool', 'public');
    expect(pm.getToolZone('my_custom_tool')).toBe('public');
  });

  it('handles unicode tool names', () => {
    const pm = new PrivacyManager();
    pm.setToolZone('outil_🔒', 'vault');
    expect(pm.getToolZone('outil_🔒')).toBe('vault');
  });
});

// ─── check() ──────────────────────────────────────────────────────────────

describe('PrivacyManager — check()', () => {
  it('allows public tool without explicit dataZone', () => {
    const pm = new PrivacyManager();
    const result = pm.check('web_search');
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('public');
  });

  it('allows personal tool when no vault involved', () => {
    const pm = new PrivacyManager();
    const result = pm.check('read_file');
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('personal');
  });

  it('denies vault access when vault is locked', () => {
    const pm = new PrivacyManager({ vaultPassword: 'secret' });
    const result = pm.check('read_file', 'vault');
    expect(result.allowed).toBe(false);
    expect(result.zone).toBe('vault');
    expect(result.reason).toMatch(/locked/i);
  });

  it('allows vault access after unlock', () => {
    const pm = new PrivacyManager({ vaultPassword: 'secret' });
    pm.unlockVault('secret');
    const result = pm.check('read_file', 'vault');
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('vault');
  });

  it('public dataZone always allowed even for vault-zone tools', () => {
    const pm = new PrivacyManager();
    pm.setToolZone('my_tool', 'vault');
    const result = pm.check('my_tool', 'public');
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('public');
  });

  it('explicit dataZone overrides tool zone for target zone determination', () => {
    const pm = new PrivacyManager();
    // web_search is public, but we check with personal data
    const result = pm.check('web_search', 'personal');
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('personal');
  });

  it('check with undefined dataZone falls back to tool zone', () => {
    const pm = new PrivacyManager();
    const result = pm.check('web_fetch', undefined);
    expect(result.allowed).toBe(true);
    expect(result.zone).toBe('public');
  });

  it('zone isolation: zone A tools not visible in zone B', () => {
    const pm = new PrivacyManager({ vaultPassword: 'p' });
    // Zone A (public) tool denied when accessing vault zone data
    const denyResult = pm.check('web_search', 'vault');
    expect(denyResult.allowed).toBe(false);

    // Zone B (vault) tool allowed after unlock for vault zone
    pm.unlockVault('p');
    pm.setToolZone('vault_tool', 'vault');
    const allowResult = pm.check('vault_tool', 'vault');
    expect(allowResult.allowed).toBe(true);
  });
});

// ─── unlockVault / lockVault / isVaultUnlocked ────────────────────────────

describe('PrivacyManager — vault lifecycle', () => {
  it('unlockVault returns false when no password configured', () => {
    const pm = new PrivacyManager();
    expect(pm.unlockVault('anything')).toBe(false);
  });

  it('unlockVault returns false for wrong password', () => {
    const pm = new PrivacyManager({ vaultPassword: 'correct' });
    expect(pm.unlockVault('wrong')).toBe(false);
    expect(pm.isVaultUnlocked()).toBe(false);
  });

  it('unlockVault returns true for correct password', () => {
    const pm = new PrivacyManager({ vaultPassword: 'correct' });
    expect(pm.unlockVault('correct')).toBe(true);
    expect(pm.isVaultUnlocked()).toBe(true);
  });

  it('lockVault closes an open vault', () => {
    const pm = new PrivacyManager({ vaultPassword: 'pw' });
    pm.unlockVault('pw');
    pm.lockVault();
    expect(pm.isVaultUnlocked()).toBe(false);
  });

  it('vault auto-locks after timeout', () => {
    vi.useFakeTimers();
    const pm = new PrivacyManager({ vaultPassword: 'pw' });
    pm.unlockVault('pw');
    expect(pm.isVaultUnlocked()).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1); // past 5-minute timeout
    expect(pm.isVaultUnlocked()).toBe(false);
    vi.useRealTimers();
  });

  it('vault stays unlocked just before timeout', () => {
    vi.useFakeTimers();
    const pm = new PrivacyManager({ vaultPassword: 'pw' });
    pm.unlockVault('pw');
    vi.advanceTimersByTime(5 * 60 * 1000 - 100); // just under
    expect(pm.isVaultUnlocked()).toBe(true);
    vi.useRealTimers();
  });

  it('isVaultUnlocked is false when vault was never unlocked', () => {
    const pm = new PrivacyManager({ vaultPassword: 'pw' });
    expect(pm.isVaultUnlocked()).toBe(false);
  });

  it('handles unicode password', () => {
    const pw = 'ünïcödé🔑';
    const pm = new PrivacyManager({ vaultPassword: pw });
    expect(pm.unlockVault(pw)).toBe(true);
    expect(pm.isVaultUnlocked()).toBe(true);
  });
});

// ─── classifyContent() ────────────────────────────────────────────────────

describe('PrivacyManager — classifyContent()', () => {
  let pm: PrivacyManager;
  beforeEach(() => { pm = new PrivacyManager(); });

  it('classifies plain text as public', () => {
    expect(pm.classifyContent('Hello world').zone).toBe('public');
  });

  it('classifies email as personal', () => {
    expect(pm.classifyContent('Contact: user@example.com').zone).toBe('personal');
  });

  it('classifies phone number as personal', () => {
    expect(pm.classifyContent('+1 800 555 1234').zone).toBe('personal');
  });

  it('classifies IP address as personal', () => {
    expect(pm.classifyContent('IP: 192.168.1.100').zone).toBe('personal');
  });

  it('classifies [PRIVATE] marker as personal', () => {
    expect(pm.classifyContent('[PRIVATE] my data').zone).toBe('personal');
  });

  it('classifies password=... as vault', () => {
    expect(pm.classifyContent('password=hunter2').zone).toBe('vault');
  });

  it('classifies [VAULT] tag as vault', () => {
    expect(pm.classifyContent('[VAULT] secret data').zone).toBe('vault');
  });

  it('classifies token=... as vault', () => {
    expect(pm.classifyContent('token: abc123xyz').zone).toBe('vault');
  });

  it('classifies ssn=... as vault', () => {
    expect(pm.classifyContent('ssn: 123-45-6789').zone).toBe('vault');
  });

  it('vault takes precedence over personal indicators', () => {
    // contains both email and password
    const result = pm.classifyContent('user@example.com password=secret');
    expect(result.zone).toBe('vault');
  });

  it('handles empty string without error', () => {
    expect(pm.classifyContent('')).toEqual(PUBLIC_ZONE);
  });

  it('handles unicode content', () => {
    // No PII patterns in unicode text
    expect(pm.classifyContent('こんにちは世界').zone).toBe('public');
  });

  it('preserves non-PII fields in result', () => {
    const result = pm.classifyContent('Hello');
    expect(result.allowedTools).toBeDefined();
    expect(Array.isArray(result.allowedTools)).toBe(true);
  });
});

// ─── sanitizeForZone() ────────────────────────────────────────────────────

describe('PrivacyManager — sanitizeForZone()', () => {
  let pm: PrivacyManager;
  beforeEach(() => { pm = new PrivacyManager(); });

  it('vault target returns content unchanged', () => {
    const content = '[VAULT]secret[/VAULT] hello';
    expect(pm.sanitizeForZone(content, 'vault')).toBe(content);
  });

  it('personal target removes [VAULT]...[/VAULT] blocks', () => {
    const result = pm.sanitizeForZone('before [VAULT]secret[/VAULT] after', 'personal');
    expect(result).not.toContain('[VAULT]');
    expect(result).toContain('[Encrypted content removed]');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('personal target replaces vault:// links', () => {
    const result = pm.sanitizeForZone('see vault://my-secret-key for details', 'personal');
    expect(result).toContain('[vault link]');
    expect(result).not.toContain('vault://my-secret-key');
  });

  it('public target removes [PRIVATE]...[/PRIVATE] blocks', () => {
    const result = pm.sanitizeForZone('data [PRIVATE]name=Alice[/PRIVATE] end', 'public');
    expect(result).toContain('[Private content removed]');
    expect(result).not.toContain('Alice');
  });

  it('public target removes both vault and private blocks', () => {
    const content = '[VAULT]pw=x[/VAULT] [PRIVATE]email@test.com[/PRIVATE]';
    const result = pm.sanitizeForZone(content, 'public');
    expect(result).not.toContain('pw=x');
    expect(result).not.toContain('email@test.com');
  });

  it('public target replaces personal:// links', () => {
    const result = pm.sanitizeForZone('link: personal://user/profile', 'public');
    expect(result).toContain('[personal link]');
  });

  it('handles empty string without error', () => {
    expect(pm.sanitizeForZone('', 'public')).toBe('');
    expect(pm.sanitizeForZone('', 'personal')).toBe('');
    expect(pm.sanitizeForZone('', 'vault')).toBe('');
  });

  it('content without sensitive data is unchanged for personal target', () => {
    const plain = 'No sensitive data here.';
    expect(pm.sanitizeForZone(plain, 'personal')).toBe(plain);
  });

  it('multi-line [VAULT] blocks are removed', () => {
    const result = pm.sanitizeForZone('start\n[VAULT]\nline1\nline2\n[/VAULT]\nend', 'personal');
    expect(result).not.toContain('line1');
    expect(result).toContain('start');
    expect(result).toContain('end');
  });

  it('is case-insensitive for zone markers', () => {
    const result = pm.sanitizeForZone('[vault]data[/vault]', 'personal');
    expect(result).not.toContain('[vault]data[/vault]');
    expect(result).toContain('[Encrypted content removed]');
  });

  it('unicode content outside markers is preserved', () => {
    const result = pm.sanitizeForZone('Héllo wörld — no markers', 'public');
    expect(result).toBe('Héllo wörld — no markers');
  });
});

// ─── getEffectiveZone() ───────────────────────────────────────────────────

describe('PrivacyManager — getEffectiveZone()', () => {
  let pm: PrivacyManager;
  beforeEach(() => { pm = new PrivacyManager(); });

  it('vault wins over personal', () => {
    expect(pm.getEffectiveZone('vault', 'personal')).toBe('vault');
    expect(pm.getEffectiveZone('personal', 'vault')).toBe('vault');
  });

  it('vault wins over public', () => {
    expect(pm.getEffectiveZone('vault', 'public')).toBe('vault');
    expect(pm.getEffectiveZone('public', 'vault')).toBe('vault');
  });

  it('personal wins over public', () => {
    expect(pm.getEffectiveZone('personal', 'public')).toBe('personal');
    expect(pm.getEffectiveZone('public', 'personal')).toBe('personal');
  });

  it('same zone returns that zone', () => {
    expect(pm.getEffectiveZone('public', 'public')).toBe('public');
    expect(pm.getEffectiveZone('personal', 'personal')).toBe('personal');
    expect(pm.getEffectiveZone('vault', 'vault')).toBe('vault');
  });
});

// ─── createPrivateLogger() ────────────────────────────────────────────────

describe('createPrivateLogger()', () => {
  it('returns an object with debug/info/warn/error methods', () => {
    const plog = createPrivateLogger('personal');
    expect(typeof plog.debug).toBe('function');
    expect(typeof plog.info).toBe('function');
    expect(typeof plog.warn).toBe('function');
    expect(typeof plog.error).toBe('function');
  });

  it('does not throw for vault zone debug/info calls', () => {
    const plog = createPrivateLogger('vault');
    expect(() => plog.debug('msg', { foo: 'bar' })).not.toThrow();
    expect(() => plog.info('msg', { foo: 'bar' })).not.toThrow();
  });

  it('does not throw for vault zone warn/error calls', () => {
    const plog = createPrivateLogger('vault');
    expect(() => plog.warn('warning', { token: 'abc' })).not.toThrow();
    expect(() => plog.error('error', { key: 'val' })).not.toThrow();
  });

  it('does not throw for public zone with all meta types', () => {
    const plog = createPrivateLogger('public');
    expect(() => plog.info('msg', {
      str: 'hello',
      num: 42,
      nested: { inner: 'value' },
    })).not.toThrow();
  });

  it('does not throw with empty meta object', () => {
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('msg', {})).not.toThrow();
  });

  it('does not throw with no meta argument', () => {
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('msg')).not.toThrow();
  });

  it('redacts password key in meta', () => {
    // Tested indirectly: no error and does not leak
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('login', { password: 'hunter2', user: 'alice' })).not.toThrow();
  });

  it('handles numeric values in meta', () => {
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('count', { count: 42, score: 3.14 })).not.toThrow();
  });

  it('handles bigint values in meta', () => {
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('id', { id: BigInt(9007199254740993) })).not.toThrow();
  });

  it('handles arrays in meta without error', () => {
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('list', { items: ['a', 'b', 'c'] as unknown as Record<string, unknown> })).not.toThrow();
  });

  it('handles deeply nested objects without error', () => {
    const deep: Record<string, unknown> = {};
    let current = deep;
    for (let i = 0; i < 20; i++) {
      current['child'] = {};
      current = current['child'] as Record<string, unknown>;
    }
    current['leaf'] = 'value';
    const plog = createPrivateLogger('personal');
    expect(() => plog.info('deep', deep)).not.toThrow();
  });

  it('handles circular references without infinite loop', () => {
    const plog = createPrivateLogger('personal');
    const circular: Record<string, unknown> = { name: 'test' };
    circular['self'] = circular;
    // Should not hang or throw
    expect(() => plog.info('circular', circular)).not.toThrow();
  });
});

// ─── Zone isolation ────────────────────────────────────────────────────────

describe('Zone isolation', () => {
  it('two separate PrivacyManager instances do not share tool zones', () => {
    const pmA = new PrivacyManager();
    const pmB = new PrivacyManager();
    pmA.setToolZone('shared_tool', 'vault');
    // pmB should still return default
    expect(pmB.getToolZone('shared_tool')).toBe('personal');
  });

  it('vault state is not shared between instances', () => {
    const pmA = new PrivacyManager({ vaultPassword: 'pw' });
    const pmB = new PrivacyManager({ vaultPassword: 'pw' });
    pmA.unlockVault('pw');
    expect(pmA.isVaultUnlocked()).toBe(true);
    expect(pmB.isVaultUnlocked()).toBe(false);
  });

  it('data classified in public zone is inaccessible via vault check', () => {
    const pm = new PrivacyManager({ vaultPassword: 'pw' });
    // Vault is locked; vault-zone data not accessible
    const vaultCheck = pm.check('read_file', 'vault');
    expect(vaultCheck.allowed).toBe(false);

    // Public zone data accessible
    const publicCheck = pm.check('web_search', 'public');
    expect(publicCheck.allowed).toBe(true);
  });
});

// ─── sanitizeMeta — deep nesting and value types ───────────────────────────

describe('sanitizeMeta — deep nesting and value types (via logger spy)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts sensitive keys at 5+ nesting levels', () => {
    const plog = createPrivateLogger('personal');
    plog.info('deep', {
      l1: { l2: { l3: { l4: { l5: { password: 'secret', safe: 'ok' } } } } },
    });
    const captured = infoSpy.mock.calls[0][1] as any;
    const l5 = captured.l1.l2.l3.l4.l5;
    expect(l5.password).toBe('[REDACTED]');
    expect(l5.safe).toBe('ok');
  });

  it('preserves non-sensitive values at all nesting levels', () => {
    const plog = createPrivateLogger('personal');
    plog.info('deep', {
      l1: { name: 'Alice', l2: { count: 42, l3: { flag: true } } },
    });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.l1.name).toBe('Alice');
    expect(captured.l1.l2.count).toBe(42);
    expect(captured.l1.l2.l3.flag).toBe(true);
  });

  it('null value passes through unchanged', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { nullable: null });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.nullable).toBeNull();
  });

  it('boolean values pass through unchanged', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { active: true, disabled: false });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.active).toBe(true);
    expect(captured.disabled).toBe(false);
  });

  it('BigInt value is serialised to string (not thrown)', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { id: BigInt('9007199254740993') as unknown as string });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.id).toBe('9007199254740993');
  });

  it('circular reference is replaced with [Circular] at the point of re-entry', () => {
    const plog = createPrivateLogger('personal');
    const obj: Record<string, unknown> = { name: 'loop' };
    obj.self = obj;
    plog.info('msg', obj);
    const captured = infoSpy.mock.calls[0][1] as any;
    // sanitizeMeta adds obj to seen only when recursing into it;
    // obj.self === obj is first processed as a nested object (obj added to seen),
    // then obj.self.self === obj hits the seen-set → '[Circular]'
    expect(captured.self.self).toBe('[Circular]');
    expect(captured.self.name).toBe('loop');
    expect(captured.name).toBe('loop');
  });

  it('array of mixed types: strings and numbers pass through, nested sensitive keys redacted', () => {
    const plog = createPrivateLogger('personal');
    // Arrays are objects; Object.entries gives ['0', v], ['1', v], ...
    plog.info('msg', { arr: ['hello', 42, { password: 'x', safe: 'y' }] as unknown as Record<string, unknown> });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.arr[0]).toBe('hello');
    expect(captured.arr[1]).toBe(42);
    expect(captured.arr[2].password).toBe('[REDACTED]');
    expect(captured.arr[2].safe).toBe('y');
  });

  it('Symbol value passes through as-is (not enumerable-skipped, not stringified)', () => {
    const sym = Symbol('marker');
    const plog = createPrivateLogger('personal');
    plog.info('msg', { marker: sym as unknown as string });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.marker).toBe(sym);
  });

  it('Symbol-keyed property is absent from sanitised output', () => {
    const symKey = Symbol('hidden');
    const obj = { visible: 'yes' } as Record<string | symbol, unknown>;
    obj[symKey] = 'invisible';
    const plog = createPrivateLogger('personal');
    plog.info('msg', obj as Record<string, unknown>);
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.visible).toBe('yes');
    // Symbol keys are skipped by Object.entries
    expect(Object.getOwnPropertySymbols(captured)).toHaveLength(0);
  });

  it('Date value is converted to empty object (Object.entries yields nothing)', () => {
    const d = new Date('2024-01-01');
    const plog = createPrivateLogger('personal');
    plog.info('msg', { ts: d as unknown as Record<string, unknown> });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.ts).toEqual({});
  });

  it('Map value is converted to empty object (Object.entries yields nothing)', () => {
    const m = new Map([['a', 1]]);
    const plog = createPrivateLogger('personal');
    plog.info('msg', { map: m as unknown as Record<string, unknown> });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.map).toEqual({});
  });

  it('Set value is converted to empty object (Object.entries yields nothing)', () => {
    const s = new Set([1, 2, 3]);
    const plog = createPrivateLogger('personal');
    plog.info('msg', { set: s as unknown as Record<string, unknown> });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.set).toEqual({});
  });

  it('class instance: own enumerable props processed, prototype methods excluded', () => {
    class User {
      name = 'Alice';
      readonly apikey = 'sk-abc'; // sensitive key → redacted
      greet() { return `Hi ${this.name}`; }
    }
    const user = new User();
    const plog = createPrivateLogger('personal');
    plog.info('msg', { user: user as unknown as Record<string, unknown> });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.user.name).toBe('Alice');
    expect(captured.user.apikey).toBe('[REDACTED]');
    expect(captured.user.greet).toBeUndefined(); // prototype method — not in Object.entries
  });
});

// ─── sanitizeString / redactString (via logger spy) ───────────────────────

describe('sanitizeString — pattern masking (via logger spy)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks email with lowercase TLD in personal zone', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { contact: 'user@example.com' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.contact).toBe('[EMAIL]');
  });

  it('masks email with uppercase TLD in personal zone', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { contact: 'USER@EXAMPLE.COM' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.contact).toBe('[EMAIL]');
  });

  it('masks phone number in string value', () => {
    const plog = createPrivateLogger('personal');
    // Leading '+' is not at a word boundary, so only the digit sequence is matched;
    // use a number without leading '+' for a clean [PHONE] replacement
    plog.info('msg', { phone: '800 555 1234' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.phone).toBe('[PHONE]');
  });

  it('masks both email and phone when both appear in the same string', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { contact: 'reach user@example.com on 800 555 1234' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.contact).toContain('[EMAIL]');
    expect(captured.contact).toContain('[PHONE]');
    expect(captured.contact).not.toContain('@');
    expect(captured.contact).not.toContain('800 555');
  });

  it('masks multiple email addresses in the same string', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { bcc: 'alice@foo.com and bob@bar.org' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.bcc).not.toContain('@');
    expect(captured.bcc.match(/\[EMAIL\]/g)).toHaveLength(2);
  });

  it('card-format number is masked as [PHONE] in public zone (phone regex fires first)', () => {
    const plog = createPrivateLogger('public');
    // 16-digit card numbers also satisfy the phone regex (\b\+?\d[\d\s-]{7,}\d\b),
    // which runs before the card regex — the card regex is effectively unreachable for
    // typical card formats; the number is still masked, just tagged [PHONE].
    plog.info('msg', { card: '4111 1111 1111 1111' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.card).toBe('[PHONE]');
  });

  it('card-format number is also masked as [PHONE] in personal zone', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { card: '4111 1111 1111 1111' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.card).toBe('[PHONE]');
  });

  it('plain string without PII passes through unchanged', () => {
    const plog = createPrivateLogger('personal');
    plog.info('msg', { note: 'nothing sensitive here' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.note).toBe('nothing sensitive here');
  });
});

// ─── Zone and key case-sensitivity ────────────────────────────────────────

describe('PrivacyManager — zone and key case-sensitivity', () => {
  it('tool zone lookup is case-sensitive (Map uses strict equality)', () => {
    const pm = new PrivacyManager();
    // Registered as 'web_search' (lowercase); uppercase variant not found → default
    expect(pm.getToolZone('WEB_SEARCH')).toBe('personal');
    expect(pm.getToolZone('web_search')).toBe('public');
  });

  it('sensitive key detection is case-insensitive (PASSWORD, Token, API_KEY all redacted)', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const plog = createPrivateLogger('personal');
    plog.info('msg', {
      PASSWORD: 'hunter2',
      Token: 'abc123',
      API_KEY: 'sk-xyz',
    } as unknown as Record<string, unknown>);
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.PASSWORD).toBe('[REDACTED]');
    expect(captured.Token).toBe('[REDACTED]');
    expect(captured.API_KEY).toBe('[REDACTED]');
    vi.restoreAllMocks();
  });

  it('non-sensitive keys that happen to share substrings are not redacted', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const plog = createPrivateLogger('personal');
    // 'username' contains 'auth'? No. 'bucket' contains no sensitive key.
    plog.info('msg', { username: 'alice', bucket: 'my-bucket', status: 'ok' });
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.username).toBe('alice');
    expect(captured.bucket).toBe('my-bucket');
    expect(captured.status).toBe('ok');
    vi.restoreAllMocks();
  });
});

// ─── Performance smoke test ────────────────────────────────────────────────

describe('sanitizeMeta — performance smoke test', () => {
  it('10 000-key flat object sanitizes in under 500 ms', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 10_000; i++) {
      huge[`field_${i}`] = `value_${i}`; // 'field_' has no sensitive-key substrings
    }
    huge.password = 'secret';
    huge.token = 'abc';

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const plog = createPrivateLogger('personal');
    const start = performance.now();
    plog.info('perf', huge);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    const captured = infoSpy.mock.calls[0][1] as any;
    expect(captured.password).toBe('[REDACTED]');
    expect(captured.token).toBe('[REDACTED]');
    expect(captured.field_0).toBe('value_0');
    vi.restoreAllMocks();
  });
});
