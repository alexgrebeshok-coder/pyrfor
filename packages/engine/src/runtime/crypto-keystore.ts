/**
 * crypto-keystore.ts — Per-identity Ed25519 keypair store for the Pyrfor engine.
 *
 * Features:
 * - Ed25519 keypair generation and import
 * - Optional AES-256-GCM encryption via scrypt KDF
 * - Atomic file writes (tmp + rename)
 * - SPKI PEM public keys for portability
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface KeyEntry {
  id: string;
  publicKey: string; // SPKI PEM
  createdAt: number;
  meta?: Record<string, unknown>;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface KeyFile {
  encrypted: boolean;
  // Encrypted fields (base64)
  salt?: string;
  iv?: string;
  authTag?: string;
  ciphertext?: string;
  // Plain fields
  privateKeyPem?: string;
}

interface KeystoreOpts {
  dir: string;
  passphrase?: string;
  clock?: () => number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class KeystoreError extends Error {
  constructor(
    public readonly code:
      | 'KEYSTORE_NOT_FOUND'
      | 'KEYSTORE_BAD_PASSPHRASE'
      | 'KEYSTORE_EXISTS'
      | 'KEYSTORE_NOT_ENCRYPTED',
    message: string,
  ) {
    super(message);
    this.name = 'KeystoreError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function keysDir(dir: string): string {
  return path.join(dir, 'keys');
}

function keyFilePath(dir: string, id: string): string {
  return path.join(keysDir(dir), `${id}.json`);
}

function indexPath(dir: string): string {
  return path.join(dir, 'index.json');
}

function atomicWrite(filePath: string, data: string): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, data, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function ensureDirs(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(keysDir(dir), { recursive: true });
}

function toBuffer(data: Uint8Array | string): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(data);
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

async function encryptPem(pem: string, passphrase: string): Promise<Omit<KeyFile, 'privateKeyPem'>> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: true,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

async function decryptPem(keyFile: KeyFile, passphrase: string): Promise<string> {
  const salt = Buffer.from(keyFile.salt!, 'base64');
  const iv = Buffer.from(keyFile.iv!, 'base64');
  const authTag = Buffer.from(keyFile.authTag!, 'base64');
  const ciphertext = Buffer.from(keyFile.ciphertext!, 'base64');
  const key = await deriveKey(passphrase, salt);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch {
    throw new KeystoreError('KEYSTORE_BAD_PASSPHRASE', 'Passphrase is incorrect or data is corrupt');
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createKeystore(opts: KeystoreOpts) {
  const { dir, passphrase, clock = Date.now } = opts;

  // Load existing index on open
  const index = new Map<string, KeyEntry>();
  ensureDirs(dir);
  const idxPath = indexPath(dir);
  if (fs.existsSync(idxPath)) {
    try {
      const entries: KeyEntry[] = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      for (const e of entries) index.set(e.id, e);
    } catch {
      // Corrupt index — start fresh
    }
  }

  function saveIndex(): void {
    atomicWrite(idxPath, JSON.stringify([...index.values()], null, 2));
  }

  async function persistKeyFile(id: string, privateKeyPem: string): Promise<void> {
    let keyFile: KeyFile;
    if (passphrase) {
      keyFile = await encryptPem(privateKeyPem, passphrase);
    } else {
      keyFile = { encrypted: false, privateKeyPem };
    }
    atomicWrite(keyFilePath(dir, id), JSON.stringify(keyFile, null, 2));
  }

  async function loadPrivateKeyPem(id: string): Promise<string> {
    const kfPath = keyFilePath(dir, id);
    if (!fs.existsSync(kfPath)) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const keyFile: KeyFile = JSON.parse(fs.readFileSync(kfPath, 'utf8'));
    if (keyFile.encrypted) {
      if (!passphrase) {
        throw new KeystoreError('KEYSTORE_NOT_ENCRYPTED', `Key ${id} is encrypted but no passphrase was provided`);
      }
      return decryptPem(keyFile, passphrase);
    }
    return keyFile.privateKeyPem!;
  }

  // ─── API ───────────────────────────────────────────────────────────────────

  async function generate(id: string, meta?: Record<string, unknown>): Promise<KeyEntry> {
    if (index.has(id)) {
      throw new KeystoreError('KEYSTORE_EXISTS', `Key already exists: ${id}`);
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const entry: KeyEntry = { id, publicKey: publicKeyPem, createdAt: clock(), ...(meta ? { meta } : {}) };
    await persistKeyFile(id, privateKeyPem);
    index.set(id, entry);
    saveIndex();
    return entry;
  }

  async function importKey(id: string, privateKeyPem: string, meta?: Record<string, unknown>): Promise<KeyEntry> {
    if (index.has(id)) {
      throw new KeystoreError('KEYSTORE_EXISTS', `Key already exists: ${id}`);
    }
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const normalizedPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const entry: KeyEntry = { id, publicKey: publicKeyPem, createdAt: clock(), ...(meta ? { meta } : {}) };
    await persistKeyFile(id, normalizedPem);
    index.set(id, entry);
    saveIndex();
    return entry;
  }

  function get(id: string): KeyEntry | undefined {
    return index.get(id);
  }

  async function getPrivateKey(id: string): Promise<crypto.KeyObject> {
    if (!index.has(id)) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const pem = await loadPrivateKeyPem(id);
    return crypto.createPrivateKey(pem);
  }

  async function sign(id: string, data: Uint8Array | string): Promise<Buffer> {
    if (!index.has(id)) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const privateKey = await getPrivateKey(id);
    return crypto.sign(null, toBuffer(data), privateKey);
  }

  async function verify(id: string, data: Uint8Array | string, signature: Buffer): Promise<boolean> {
    const entry = index.get(id);
    if (!entry) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const publicKey = crypto.createPublicKey(entry.publicKey);
    return crypto.verify(null, toBuffer(data), publicKey, signature);
  }

  function verifyExternal(
    publicKey: string | crypto.KeyObject,
    data: Uint8Array | string,
    signature: Buffer,
  ): boolean {
    const key = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
    return crypto.verify(null, toBuffer(data), key, signature);
  }

  function list(): KeyEntry[] {
    return [...index.values()];
  }

  async function remove(id: string): Promise<boolean> {
    if (!index.has(id)) return false;
    index.delete(id);
    saveIndex();
    const kfPath = keyFilePath(dir, id);
    if (fs.existsSync(kfPath)) {
      fs.unlinkSync(kfPath);
    }
    return true;
  }

  async function rotate(id: string): Promise<KeyEntry> {
    const existing = index.get(id);
    if (!existing) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const entry: KeyEntry = {
      id,
      publicKey: publicKeyPem,
      createdAt: clock(),
      ...(existing.meta ? { meta: existing.meta } : {}),
    };
    await persistKeyFile(id, privateKeyPem);
    index.set(id, entry);
    saveIndex();
    return entry;
  }

  async function exportKey(id: string): Promise<{ publicKey: string; privateKey: string }> {
    const entry = index.get(id);
    if (!entry) {
      throw new KeystoreError('KEYSTORE_NOT_FOUND', `Key not found: ${id}`);
    }
    const privateKeyPem = await loadPrivateKeyPem(id);
    return { publicKey: entry.publicKey, privateKey: privateKeyPem };
  }

  return {
    generate,
    import: importKey,
    get,
    getPrivateKey,
    sign,
    verify,
    verifyExternal,
    list,
    remove,
    rotate,
    export: exportKey,
  };
}
