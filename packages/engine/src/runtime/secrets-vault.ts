/**
 * secrets-vault — Local encrypted secrets store using AES-256-GCM + scrypt.
 *
 * Vault file format (VaultSnapshot):
 *   { version:1, salt, iv, algo:'aes-256-gcm', kdf:'scrypt', ciphertext, tag }
 *   All binary fields stored as base64.
 *
 * Security notes:
 *   - Fresh 12-byte IV generated on every flush (salt kept per-session).
 *   - scrypt N=2^14, r=8, p=1, keylen=32 by default.
 *   - Derived key + salt zeroed in memory on lock().
 *   - GCM auth-tag ensures integrity — tampered ciphertext throws on decrypt.
 *   - File writes are atomic (tmp + rename).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type VaultEntry = {
  id: string;
  name: string;
  value: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, string>;
};

export type VaultSnapshot = {
  version: 1;
  salt: string;        // base64, 16 bytes
  iv: string;          // base64, 12 bytes
  algo: 'aes-256-gcm';
  kdf: 'scrypt';
  ciphertext: string;  // base64
  tag: string;         // base64, 16 bytes GCM auth tag
};

// ── Options ───────────────────────────────────────────────────────────────────

export type ScryptParams = { N: number; r: number; p: number; keylen: number };

export type SecretsVaultOpts = {
  storePath: string;
  clock?: () => number;
  logger?: (msg: string, meta?: unknown) => void;
  scryptParams?: Partial<ScryptParams>;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SCRYPT: ScryptParams = { N: 1 << 14, r: 8, p: 1, keylen: 32 };

// ── Crypto helpers ────────────────────────────────────────────────────────────

function scryptAsync(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const { N, r, p, keylen } = params;
  return new Promise((resolve, reject) =>
    crypto.scrypt(passphrase, salt, keylen, { N, r, p }, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    ),
  );
}

function encryptGCM(
  plaintext: string,
  key: Buffer,
): { iv: string; ciphertext: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptGCM(ciphertext: string, iv: string, tag: string, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('VAULT_UNLOCK_FAILED');
  }
}

function writeAtomic(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function nanoid(): string {
  return crypto.randomBytes(12).toString('hex');
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSecretsVault(opts: SecretsVaultOpts) {
  const {
    storePath,
    clock = () => Date.now(),
    logger = () => undefined,
    scryptParams: scryptOverride = {},
  } = opts;

  const scrypt: ScryptParams = { ...DEFAULT_SCRYPT, ...scryptOverride };

  // ── In-memory state ────────────────────────────────────────────────────────
  let entries = new Map<string, VaultEntry>();
  let derivedKey: Buffer | null = null;
  let currentSalt: Buffer | null = null;  // salt that produced derivedKey

  // ── Internal helpers ───────────────────────────────────────────────────────

  function assertUnlocked(): void {
    if (!derivedKey) throw new Error('VAULT_LOCKED');
  }

  function clearState(): void {
    if (derivedKey) { derivedKey.fill(0); derivedKey = null; }
    if (currentSalt) { currentSalt.fill(0); currentSalt = null; }
    entries = new Map();
  }

  function serializeEntries(): string {
    return JSON.stringify(Array.from(entries.values()));
  }

  function deserializeEntries(json: string): Map<string, VaultEntry> {
    const arr = JSON.parse(json) as VaultEntry[];
    return new Map(arr.map((e) => [e.name, e]));
  }

  // ── unlock ─────────────────────────────────────────────────────────────────

  async function unlock(passphrase: string): Promise<void> {
    if (!fs.existsSync(storePath)) {
      // No vault file yet — create fresh empty vault
      const salt = crypto.randomBytes(16);
      const key = await scryptAsync(passphrase, salt, scrypt);
      clearState();
      derivedKey = key;
      currentSalt = salt;
      entries = new Map();
      logger('vault: created empty vault', { storePath });
      return;
    }

    // Load and decrypt existing snapshot
    let snapshot: VaultSnapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(storePath, 'utf8')) as VaultSnapshot;
    } catch {
      throw new Error('VAULT_UNLOCK_FAILED');
    }

    const salt = Buffer.from(snapshot.salt, 'base64');
    const key = await scryptAsync(passphrase, salt, scrypt);

    let plaintext: string;
    try {
      plaintext = decryptGCM(snapshot.ciphertext, snapshot.iv, snapshot.tag, key);
    } catch {
      key.fill(0);
      throw new Error('VAULT_UNLOCK_FAILED');
    }

    let loaded: Map<string, VaultEntry>;
    try {
      loaded = deserializeEntries(plaintext);
    } catch {
      key.fill(0);
      throw new Error('VAULT_UNLOCK_FAILED');
    }

    clearState();
    derivedKey = key;
    currentSalt = salt;
    entries = loaded;
    logger('vault: unlocked', { storePath, count: entries.size });
  }

  // ── lock ───────────────────────────────────────────────────────────────────

  function lock(): void {
    clearState();
    logger('vault: locked');
  }

  // ── isUnlocked ─────────────────────────────────────────────────────────────

  function isUnlocked(): boolean {
    return derivedKey !== null;
  }

  // ── changePassphrase ───────────────────────────────────────────────────────

  async function changePassphrase(oldP: string, newP: string): Promise<void> {
    assertUnlocked();

    // Verify old passphrase by re-deriving with current salt and comparing
    const reKey = await scryptAsync(oldP, currentSalt!, scrypt);
    const valid =
      reKey.length === derivedKey!.length &&
      crypto.timingSafeEqual(reKey, derivedKey!);
    reKey.fill(0);
    if (!valid) throw new Error('VAULT_WRONG_PASSPHRASE');

    // Derive new key with a fresh salt
    const newSalt = crypto.randomBytes(16);
    const newKey = await scryptAsync(newP, newSalt, scrypt);

    // Write encrypted snapshot with new key before swapping memory state
    const { iv, ciphertext, tag } = encryptGCM(serializeEntries(), newKey);
    const snapshot: VaultSnapshot = {
      version: 1,
      salt: newSalt.toString('base64'),
      iv,
      algo: 'aes-256-gcm',
      kdf: 'scrypt',
      ciphertext,
      tag,
    };
    writeAtomic(storePath, JSON.stringify(snapshot, null, 2));

    if (derivedKey) derivedKey.fill(0);
    if (currentSalt) currentSalt.fill(0);
    derivedKey = newKey;
    currentSalt = newSalt;
    logger('vault: passphrase changed');
  }

  // ── put ────────────────────────────────────────────────────────────────────

  function put(
    name: string,
    value: string,
    putOpts?: { tags?: string[]; meta?: Record<string, string> },
  ): VaultEntry {
    assertUnlocked();
    const now = clock();
    const existing = entries.get(name);
    const entry: VaultEntry = {
      id: existing?.id ?? nanoid(),
      name,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (putOpts?.tags !== undefined) entry.tags = putOpts.tags;
    else if (existing?.tags !== undefined) entry.tags = existing.tags;
    if (putOpts?.meta !== undefined) entry.meta = putOpts.meta;
    else if (existing?.meta !== undefined) entry.meta = existing.meta;
    entries.set(name, entry);
    return entry;
  }

  // ── get ────────────────────────────────────────────────────────────────────

  function get(name: string): VaultEntry | undefined {
    assertUnlocked();
    return entries.get(name);
  }

  // ── getValue ───────────────────────────────────────────────────────────────

  function getValue(name: string): string | undefined {
    assertUnlocked();
    return entries.get(name)?.value;
  }

  // ── list ───────────────────────────────────────────────────────────────────

  function list(filter?: { tag?: string; namePrefix?: string }): VaultEntry[] {
    assertUnlocked();
    let result = Array.from(entries.values());
    if (filter?.tag) {
      const tag = filter.tag;
      result = result.filter((e) => e.tags?.includes(tag));
    }
    if (filter?.namePrefix) {
      const prefix = filter.namePrefix;
      result = result.filter((e) => e.name.startsWith(prefix));
    }
    return result;
  }

  // ── remove ─────────────────────────────────────────────────────────────────

  function remove(name: string): boolean {
    assertUnlocked();
    return entries.delete(name);
  }

  // ── rotate ─────────────────────────────────────────────────────────────────

  function rotate(name: string, newValue: string): VaultEntry | undefined {
    assertUnlocked();
    const existing = entries.get(name);
    if (!existing) return undefined;
    const updated: VaultEntry = { ...existing, value: newValue, updatedAt: clock() };
    entries.set(name, updated);
    return updated;
  }

  // ── flush ──────────────────────────────────────────────────────────────────

  async function flush(): Promise<void> {
    assertUnlocked();
    const { iv, ciphertext, tag } = encryptGCM(serializeEntries(), derivedKey!);
    const snapshot: VaultSnapshot = {
      version: 1,
      salt: currentSalt!.toString('base64'),
      iv,
      algo: 'aes-256-gcm',
      kdf: 'scrypt',
      ciphertext,
      tag,
    };
    writeAtomic(storePath, JSON.stringify(snapshot, null, 2));
    logger('vault: flushed', { storePath, count: entries.size });
  }

  // ── reset ──────────────────────────────────────────────────────────────────

  async function reset(): Promise<void> {
    assertUnlocked();
    entries = new Map();
    await flush();
    logger('vault: reset');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    unlock,
    lock,
    isUnlocked,
    changePassphrase,
    put,
    get,
    getValue,
    list,
    remove,
    rotate,
    flush,
    reset,
  };
}
