// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'node:crypto';
import { createKeystore, KeystoreError, type KeyEntry } from './crypto-keystore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dirs: string[] = [];

function tmpDir(): string {
  const d = path.join(
    os.tmpdir(),
    `keystore-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generate', () => {
  it('creates a keypair and returns a KeyEntry', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    const entry = await ks.generate('alice');
    expect(entry.id).toBe('alice');
    expect(entry.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(typeof entry.createdAt).toBe('number');
  });

  it('get returns the entry after generate', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const e = ks.get('alice');
    expect(e).toBeDefined();
    expect(e!.id).toBe('alice');
  });

  it('list contains the generated entry', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const lst = ks.list();
    expect(lst.some(e => e.id === 'alice')).toBe(true);
  });

  it('duplicate id throws KEYSTORE_EXISTS', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    await expect(ks.generate('alice')).rejects.toMatchObject({ code: 'KEYSTORE_EXISTS' });
  });

  it('meta is preserved and retrievable', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice', { role: 'admin', level: 5 });
    const e = ks.get('alice')!;
    expect(e.meta).toEqual({ role: 'admin', level: 5 });
  });

  it('uses custom clock for createdAt', async () => {
    const ks = createKeystore({ dir: tmpDir(), clock: () => 12345 });
    const e = await ks.generate('alice');
    expect(e.createdAt).toBe(12345);
  });
});

describe('sign / verify', () => {
  it('sign + verify roundtrip succeeds with string', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'hello world');
    expect(await ks.verify('alice', 'hello world', sig)).toBe(true);
  });

  it('sign + verify roundtrip succeeds with Uint8Array', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const data = new TextEncoder().encode('hello bytes');
    const sig = await ks.sign('alice', data);
    expect(await ks.verify('alice', data, sig)).toBe(true);
  });

  it('verify with wrong key returns false', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir });
    await ks.generate('alice');
    await ks.generate('bob');
    const sig = await ks.sign('alice', 'data');
    expect(await ks.verify('bob', 'data', sig)).toBe(false);
  });

  it('verify with tampered data returns false', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'original');
    expect(await ks.verify('alice', 'tampered', sig)).toBe(false);
  });

  it('sign throws KEYSTORE_NOT_FOUND for missing id', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await expect(ks.sign('ghost', 'data')).rejects.toMatchObject({ code: 'KEYSTORE_NOT_FOUND' });
  });
});

describe('verifyExternal', () => {
  it('works with raw PEM public key string', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'hello');
    const entry = ks.get('alice')!;
    expect(ks.verifyExternal(entry.publicKey, 'hello', sig)).toBe(true);
  });

  it('works with a KeyObject', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'hello');
    const entry = ks.get('alice')!;
    const keyObj = crypto.createPublicKey(entry.publicKey);
    expect(ks.verifyExternal(keyObj, 'hello', sig)).toBe(true);
  });

  it('returns false for wrong signature', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'hello');
    expect(ks.verifyExternal(ks.get('alice')!.publicKey, 'wrong', sig)).toBe(false);
  });
});

describe('import', () => {
  it('accepts PEM private key and sign works', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const ks = createKeystore({ dir: tmpDir() });
    const entry = await ks.import('external', pem);
    expect(entry.id).toBe('external');
    const sig = await ks.sign('external', 'test');
    expect(await ks.verify('external', 'test', sig)).toBe(true);
  });

  it('duplicate import throws KEYSTORE_EXISTS', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const ks = createKeystore({ dir: tmpDir() });
    await ks.import('external', pem);
    await expect(ks.import('external', pem)).rejects.toMatchObject({ code: 'KEYSTORE_EXISTS' });
  });

  it('imports with meta', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const ks = createKeystore({ dir: tmpDir() });
    const entry = await ks.import('ext', pem, { source: 'legacy' });
    expect(entry.meta).toEqual({ source: 'legacy' });
  });
});

describe('remove', () => {
  it('returns true and get returns undefined', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    expect(await ks.remove('alice')).toBe(true);
    expect(ks.get('alice')).toBeUndefined();
  });

  it('remove non-existent returns false', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    expect(await ks.remove('ghost')).toBe(false);
  });

  it('list no longer contains removed entry', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    await ks.remove('alice');
    expect(ks.list().some(e => e.id === 'alice')).toBe(false);
  });
});

describe('list', () => {
  it('reflects multiple entries', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    await ks.generate('bob');
    await ks.generate('carol');
    const ids = ks.list().map(e => e.id);
    expect(ids).toContain('alice');
    expect(ids).toContain('bob');
    expect(ids).toContain('carol');
    expect(ids).toHaveLength(3);
  });
});

describe('rotate', () => {
  it('replaces keys but preserves id and meta', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice', { role: 'admin' });
    const before = ks.get('alice')!;
    const rotated = await ks.rotate('alice');

    expect(rotated.id).toBe('alice');
    expect(rotated.meta).toEqual({ role: 'admin' });
    expect(rotated.publicKey).not.toBe(before.publicKey);
  });

  it('old signature no longer verifies after rotate', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'data');
    await ks.rotate('alice');
    // verify uses stored (new) public key
    expect(await ks.verify('alice', 'data', sig)).toBe(false);
  });

  it('rotate throws KEYSTORE_NOT_FOUND for missing id', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await expect(ks.rotate('ghost')).rejects.toMatchObject({ code: 'KEYSTORE_NOT_FOUND' });
  });
});

describe('passphrase encryption', () => {
  it('file on disk does not contain plain PEM when passphrase set', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'secret' });
    await ks.generate('alice');
    const raw = fs.readFileSync(path.join(dir, 'keys', 'alice.json'), 'utf8');
    expect(raw).not.toContain('BEGIN PRIVATE KEY');
    expect(raw).toContain('"encrypted": true');
  });

  it('getPrivateKey decrypts correctly with right passphrase', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'secret' });
    await ks.generate('alice');
    const privKey = await ks.getPrivateKey('alice');
    expect(privKey.asymmetricKeyType).toBe('ed25519');
  });

  it('wrong passphrase throws KEYSTORE_BAD_PASSPHRASE on getPrivateKey', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'correct' });
    await ks.generate('alice');
    const ksWrong = createKeystore({ dir, passphrase: 'wrong' });
    await expect(ksWrong.getPrivateKey('alice')).rejects.toMatchObject({
      code: 'KEYSTORE_BAD_PASSPHRASE',
    });
  });

  it('wrong passphrase throws KEYSTORE_BAD_PASSPHRASE on sign', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'correct' });
    await ks.generate('alice');
    const ksWrong = createKeystore({ dir, passphrase: 'wrong' });
    await expect(ksWrong.sign('alice', 'data')).rejects.toMatchObject({
      code: 'KEYSTORE_BAD_PASSPHRASE',
    });
  });

  it('sign/verify works end-to-end with passphrase', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'mysecret' });
    await ks.generate('alice');
    const sig = await ks.sign('alice', 'hello');
    expect(await ks.verify('alice', 'hello', sig)).toBe(true);
  });
});

describe('plain (no passphrase) storage', () => {
  it('file stores plain PEM when no passphrase', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir });
    await ks.generate('alice');
    const raw = fs.readFileSync(path.join(dir, 'keys', 'alice.json'), 'utf8');
    expect(raw).toContain('BEGIN PRIVATE KEY');
    expect(raw).toContain('"encrypted": false');
  });
});

describe('export', () => {
  it('returns PEM strings for public and private key', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const { publicKey, privateKey } = await ks.export('alice');
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('throws KEYSTORE_NOT_FOUND for missing id', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await expect(ks.export('ghost')).rejects.toMatchObject({ code: 'KEYSTORE_NOT_FOUND' });
  });

  it('export works with passphrase', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir, passphrase: 'pw' });
    await ks.generate('alice');
    const { publicKey, privateKey } = await ks.export('alice');
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
  });
});

describe('index.json persistence', () => {
  it('round-trips on reopen: new keystore reads existing dir', async () => {
    const dir = tmpDir();
    const ks1 = createKeystore({ dir });
    await ks1.generate('alice', { tag: 'persistent' });
    await ks1.generate('bob');

    const ks2 = createKeystore({ dir });
    expect(ks2.get('alice')).toBeDefined();
    expect(ks2.get('alice')!.meta).toEqual({ tag: 'persistent' });
    expect(ks2.get('bob')).toBeDefined();
    expect(ks2.list()).toHaveLength(2);
  });

  it('reopened keystore can sign with stored key', async () => {
    const dir = tmpDir();
    const ks1 = createKeystore({ dir });
    await ks1.generate('alice');

    const ks2 = createKeystore({ dir });
    const sig = await ks2.sign('alice', 'persistent');
    expect(await ks2.verify('alice', 'persistent', sig)).toBe(true);
  });
});

describe('atomic write', () => {
  it('no .tmp file left after successful write', async () => {
    const dir = tmpDir();
    const ks = createKeystore({ dir });
    await ks.generate('alice');

    const keysDirectory = path.join(dir, 'keys');
    const files = fs.readdirSync(keysDirectory);
    const tmps = files.filter(f => f.includes('.tmp.'));
    expect(tmps).toHaveLength(0);
  });
});

describe('concurrent generate', () => {
  it('concurrent generate of different ids all succeed', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const entries = await Promise.all(ids.map(id => ks.generate(id)));
    expect(entries).toHaveLength(5);
    for (const id of ids) {
      expect(ks.get(id)).toBeDefined();
    }
  });
});

describe('getPrivateKey', () => {
  it('throws KEYSTORE_NOT_FOUND for missing id', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await expect(ks.getPrivateKey('ghost')).rejects.toMatchObject({ code: 'KEYSTORE_NOT_FOUND' });
  });

  it('returns a KeyObject with correct type', async () => {
    const ks = createKeystore({ dir: tmpDir() });
    await ks.generate('alice');
    const k = await ks.getPrivateKey('alice');
    expect(k.asymmetricKeyType).toBe('ed25519');
    expect(k.type).toBe('private');
  });
});
