// @vitest-environment node
/**
 * Tests for secrets-vault — AES-256-GCM encrypted local secrets store.
 *
 * Light scryptParams (N=1024) are used throughout to keep tests fast.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { createSecretsVault } from './secrets-vault';
import type { VaultSnapshot } from './secrets-vault';

// ── Test helpers ──────────────────────────────────────────────────────────────

const FAST_SCRYPT = { N: 1024, r: 8, p: 1, keylen: 32 };

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
}

function makeVault(dir: string, overrides?: Partial<Parameters<typeof createSecretsVault>[0]>) {
  return createSecretsVault({
    storePath: path.join(dir, 'vault.enc'),
    scryptParams: FAST_SCRYPT,
    ...overrides,
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('secrets-vault', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // ── 1. Unlock with no file creates empty vault ─────────────────────────────

  it('unlock without existing file creates empty vault', async () => {
    const vault = makeVault(dir);
    await vault.unlock('passphrase');
    expect(vault.isUnlocked()).toBe(true);
    expect(vault.list()).toEqual([]);
  });

  // ── 2. put then get returns the entry ─────────────────────────────────────

  it('put then get returns entry with correct fields', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    const entry = vault.put('TELEGRAM_TOKEN', 'abc123');
    expect(entry.name).toBe('TELEGRAM_TOKEN');
    expect(entry.value).toBe('abc123');
    expect(typeof entry.id).toBe('string');
    expect(entry.createdAt).toBeLessThanOrEqual(Date.now());
    const fetched = vault.get('TELEGRAM_TOKEN');
    expect(fetched).toEqual(entry);
  });

  // ── 3. getValue convenience ────────────────────────────────────────────────

  it('getValue returns value string or undefined for missing key', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('KEY', 'secret');
    expect(vault.getValue('KEY')).toBe('secret');
    expect(vault.getValue('MISSING')).toBeUndefined();
  });

  // ── 4. list filters by tag ────────────────────────────────────────────────

  it('list filters by tag', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('A', 'v1', { tags: ['ai'] });
    vault.put('B', 'v2', { tags: ['telegram'] });
    vault.put('C', 'v3', { tags: ['ai', 'telegram'] });
    const ai = vault.list({ tag: 'ai' });
    expect(ai.map((e) => e.name).sort()).toEqual(['A', 'C']);
  });

  // ── 5. list filters by namePrefix ────────────────────────────────────────

  it('list filters by namePrefix', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('OPENROUTER_KEY', 'v1');
    vault.put('OPENROUTER_MODEL', 'v2');
    vault.put('ZHIPU_KEY', 'v3');
    const or = vault.list({ namePrefix: 'OPENROUTER' });
    expect(or.map((e) => e.name).sort()).toEqual(['OPENROUTER_KEY', 'OPENROUTER_MODEL']);
  });

  // ── 6. list with no filter returns all ────────────────────────────────────

  it('list with no filter returns all entries', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('A', '1');
    vault.put('B', '2');
    vault.put('C', '3');
    expect(vault.list()).toHaveLength(3);
  });

  // ── 7. remove returns true/false ──────────────────────────────────────────

  it('remove returns true for existing entry and false for missing', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('X', 'val');
    expect(vault.remove('X')).toBe(true);
    expect(vault.remove('X')).toBe(false);
    expect(vault.get('X')).toBeUndefined();
  });

  // ── 8. rotate updates value and updatedAt ─────────────────────────────────

  it('rotate updates value and updatedAt but preserves createdAt and id', async () => {
    let t = 1000;
    const vault = makeVault(dir, { clock: () => t });
    await vault.unlock('pass');
    const orig = vault.put('K', 'old');
    t = 2000;
    const updated = vault.rotate('K', 'new');
    expect(updated).toBeDefined();
    expect(updated!.value).toBe('new');
    expect(updated!.updatedAt).toBe(2000);
    expect(updated!.createdAt).toBe(orig.createdAt);
    expect(updated!.id).toBe(orig.id);
  });

  // ── 9. rotate returns undefined for unknown key ────────────────────────────

  it('rotate returns undefined for a key that does not exist', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    expect(vault.rotate('GHOST', 'val')).toBeUndefined();
  });

  // ── 10. flush persists encrypted file ─────────────────────────────────────

  it('flush creates an encrypted file on disk', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('API_KEY', 'secret');
    await vault.flush();
    expect(fs.existsSync(storePath)).toBe(true);
    const raw = fs.readFileSync(storePath, 'utf8');
    const snap = JSON.parse(raw) as VaultSnapshot;
    expect(snap.version).toBe(1);
    expect(snap.algo).toBe('aes-256-gcm');
    expect(snap.kdf).toBe('scrypt');
    // Plaintext value must NOT appear in file
    expect(raw).not.toContain('secret');
  });

  // ── 11. re-open with same passphrase returns entries ──────────────────────

  it('re-open vault with same passphrase recovers all entries', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('mypass');
    v1.put('ZHIPU_KEY', 'zhipu-secret', { tags: ['ai'] });
    v1.put('TG_TOKEN', 'tg-secret');
    await v1.flush();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('mypass');
    expect(v2.getValue('ZHIPU_KEY')).toBe('zhipu-secret');
    expect(v2.getValue('TG_TOKEN')).toBe('tg-secret');
    expect(v2.list({ tag: 'ai' })).toHaveLength(1);
  });

  // ── 12. re-open with wrong passphrase throws VAULT_UNLOCK_FAILED ──────────

  it('re-open with wrong passphrase throws VAULT_UNLOCK_FAILED', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('correct');
    v1.put('KEY', 'val');
    await v1.flush();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await expect(v2.unlock('wrong')).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });

  // ── 13. lock then put throws VAULT_LOCKED ────────────────────────────────

  it('put after lock throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('K', 'v');
    vault.lock();
    expect(() => vault.put('K2', 'v2')).toThrow('VAULT_LOCKED');
  });

  // ── 14. lock then get throws ──────────────────────────────────────────────

  it('get after lock throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.lock();
    expect(() => vault.get('X')).toThrow('VAULT_LOCKED');
  });

  // ── 15. lock then list throws ─────────────────────────────────────────────

  it('list after lock throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.lock();
    expect(() => vault.list()).toThrow('VAULT_LOCKED');
  });

  // ── 16. isUnlocked reflects state ────────────────────────────────────────

  it('isUnlocked correctly reflects locked/unlocked state', async () => {
    const vault = makeVault(dir);
    expect(vault.isUnlocked()).toBe(false);
    await vault.unlock('pass');
    expect(vault.isUnlocked()).toBe(true);
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
  });

  // ── 17. changePassphrase: old data readable with new pass ─────────────────

  it('changePassphrase allows reading data with new passphrase', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('oldpass');
    v1.put('SECRET', 'value123');
    await v1.flush();
    await v1.changePassphrase('oldpass', 'newpass');

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('newpass');
    expect(v2.getValue('SECRET')).toBe('value123');
  });

  // ── 18. changePassphrase rejects wrong old pass ───────────────────────────

  it('changePassphrase rejects wrong old passphrase', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('correct');
    v1.put('K', 'v');
    await v1.flush();
    await expect(v1.changePassphrase('wrong', 'newpass')).rejects.toThrow(
      'VAULT_WRONG_PASSPHRASE',
    );
  });

  // ── 19. old passphrase rejected after changePassphrase ────────────────────

  it('old passphrase no longer works after changePassphrase', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('old');
    v1.put('K', 'v');
    await v1.flush();
    await v1.changePassphrase('old', 'new');

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await expect(v2.unlock('old')).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });

  // ── 20. tampered ciphertext detected ─────────────────────────────────────

  it('tampered ciphertext causes unlock to throw VAULT_UNLOCK_FAILED', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('K', 'v');
    await v1.flush();

    // Flip a byte in the ciphertext
    const snap = JSON.parse(fs.readFileSync(storePath, 'utf8')) as VaultSnapshot;
    const ctBuf = Buffer.from(snap.ciphertext, 'base64');
    ctBuf[0] ^= 0xff;
    snap.ciphertext = ctBuf.toString('base64');
    fs.writeFileSync(storePath, JSON.stringify(snap));

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await expect(v2.unlock('pass')).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });

  // ── 21. tampered auth tag detected ───────────────────────────────────────

  it('tampered auth tag causes unlock to throw VAULT_UNLOCK_FAILED', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('K', 'v');
    await v1.flush();

    const snap = JSON.parse(fs.readFileSync(storePath, 'utf8')) as VaultSnapshot;
    const tagBuf = Buffer.from(snap.tag, 'base64');
    tagBuf[0] ^= 0xff;
    snap.tag = tagBuf.toString('base64');
    fs.writeFileSync(storePath, JSON.stringify(snap));

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await expect(v2.unlock('pass')).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });

  // ── 22. corrupt JSON file throws VAULT_UNLOCK_FAILED ─────────────────────

  it('corrupt JSON file throws VAULT_UNLOCK_FAILED on unlock', async () => {
    const storePath = path.join(dir, 'vault.enc');
    fs.writeFileSync(storePath, 'not-valid-json{{{{');
    const vault = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await expect(vault.unlock('pass')).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });

  // ── 23. reset wipes all entries and persists empty ───────────────────────

  it('reset wipes all entries and writes empty vault', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('A', '1');
    v1.put('B', '2');
    await v1.reset();
    expect(v1.list()).toEqual([]);

    // Confirm persistence
    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('pass');
    expect(v2.list()).toEqual([]);
  });

  // ── 24. put preserves id across updates ──────────────────────────────────

  it('put with same name preserves id and createdAt', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    const first = vault.put('K', 'v1');
    const second = vault.put('K', 'v2');
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.value).toBe('v2');
  });

  // ── 25. put carries tags and meta through to result ──────────────────────

  it('put stores tags and meta correctly', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    const entry = vault.put('K', 'val', {
      tags: ['prod', 'llm'],
      meta: { source: 'manual' },
    });
    expect(entry.tags).toEqual(['prod', 'llm']);
    expect(entry.meta).toEqual({ source: 'manual' });
  });

  // ── 26. unlock can be called again to re-unlock after lock ───────────────

  it('vault can be re-unlocked after being locked', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const vault = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await vault.unlock('pass');
    vault.put('K', 'v');
    await vault.flush();
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    await vault.unlock('pass');
    expect(vault.getValue('K')).toBe('v');
  });

  // ── 27. flush with no entries writes valid empty snapshot ─────────────────

  it('flush with no entries writes valid snapshot that re-opens as empty', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    await v1.flush();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('pass');
    expect(v2.list()).toEqual([]);
  });

  // ── 28. snapshot fields have expected structure ───────────────────────────

  it('flushed snapshot has expected structural fields', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const vault = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await vault.unlock('pass');
    vault.put('K', 'v');
    await vault.flush();
    const snap = JSON.parse(fs.readFileSync(storePath, 'utf8')) as VaultSnapshot;
    expect(snap.version).toBe(1);
    expect(snap.algo).toBe('aes-256-gcm');
    expect(snap.kdf).toBe('scrypt');
    // salt: 16 bytes → 24 base64 chars
    expect(Buffer.from(snap.salt, 'base64')).toHaveLength(16);
    // iv: 12 bytes → 16 base64 chars
    expect(Buffer.from(snap.iv, 'base64')).toHaveLength(12);
    // tag: 16 bytes
    expect(Buffer.from(snap.tag, 'base64')).toHaveLength(16);
  });

  // ── 29. list with combined tag+prefix filter ──────────────────────────────

  it('list applies both tag and namePrefix filters simultaneously', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('OR_KEY', 'v1', { tags: ['ai'] });
    vault.put('OR_MODEL', 'v2', { tags: ['ai'] });
    vault.put('TG_TOKEN', 'v3', { tags: ['ai'] });
    const result = vault.list({ tag: 'ai', namePrefix: 'OR' });
    expect(result.map((e) => e.name).sort()).toEqual(['OR_KEY', 'OR_MODEL']);
  });

  // ── 30. remove then list does not include removed entry ───────────────────

  it('remove then list does not include the removed entry', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('A', '1');
    vault.put('B', '2');
    vault.remove('A');
    const names = vault.list().map((e) => e.name);
    expect(names).not.toContain('A');
    expect(names).toContain('B');
  });

  // ── 31. flush is atomic (no partial file) ─────────────────────────────────

  it('no .tmp files remain after flush', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.put('K', 'v');
    await vault.flush();
    const files = fs.readdirSync(dir);
    expect(files.every((f) => !f.includes('.tmp-'))).toBe(true);
  });

  // ── 32. flush after remove persists removal ───────────────────────────────

  it('flush after remove persists removal across re-open', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('A', 'aval');
    v1.put('B', 'bval');
    await v1.flush();
    v1.remove('A');
    await v1.flush();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('pass');
    expect(v2.getValue('A')).toBeUndefined();
    expect(v2.getValue('B')).toBe('bval');
  });

  // ── 33. remove on locked vault throws ────────────────────────────────────

  it('remove on locked vault throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.lock();
    expect(() => vault.remove('K')).toThrow('VAULT_LOCKED');
  });

  // ── 34. rotate on locked vault throws ────────────────────────────────────

  it('rotate on locked vault throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.lock();
    expect(() => vault.rotate('K', 'v')).toThrow('VAULT_LOCKED');
  });

  // ── 35. getValue on locked vault throws ──────────────────────────────────

  it('getValue on locked vault throws VAULT_LOCKED', async () => {
    const vault = makeVault(dir);
    await vault.unlock('pass');
    vault.lock();
    expect(() => vault.getValue('K')).toThrow('VAULT_LOCKED');
  });

  // ── 36. multiple entries preserved through flush/re-open cycle ────────────

  it('multiple entries with metadata round-trip through flush/re-open', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('TELEGRAM_TOKEN', 'tg-val', { tags: ['telegram'], meta: { env: 'prod' } });
    v1.put('ZHIPU_KEY', 'zh-val', { tags: ['ai', 'zhipu'] });
    v1.put('OPENROUTER_KEY', 'or-val', { tags: ['ai'] });
    await v1.flush();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('pass');
    expect(v2.getValue('TELEGRAM_TOKEN')).toBe('tg-val');
    expect(v2.get('TELEGRAM_TOKEN')?.meta).toEqual({ env: 'prod' });
    expect(v2.list({ tag: 'ai' })).toHaveLength(2);
    expect(v2.list({ namePrefix: 'OPENROUTER' })).toHaveLength(1);
  });

  // ── 37. empty ciphertext body still validates GCM tag ─────────────────────

  it('vault with empty entry set (reset) is valid after re-open', async () => {
    const storePath = path.join(dir, 'vault.enc');
    const v1 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v1.unlock('pass');
    v1.put('TEMP', 'data');
    await v1.flush();
    await v1.reset();

    const v2 = createSecretsVault({ storePath, scryptParams: FAST_SCRYPT });
    await v2.unlock('pass');
    expect(v2.list()).toHaveLength(0);
  });
});
