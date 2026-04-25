// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUri,
  totp,
  verifyHotp,
  verifyTotp,
} from './otp-totp.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** RFC 4226 / 6238 ASCII secrets → base32-encoded form accepted by our API. */
const b32 = (ascii: string) => base32Encode(Buffer.from(ascii));

const RFC_SECRET_SHA1 = b32('12345678901234567890');
const RFC_SECRET_SHA256 = b32('12345678901234567890123456789012');
const RFC_SECRET_SHA512 = b32(
  '1234567890123456789012345678901234567890123456789012345678901234',
);

// ─── Base32 ──────────────────────────────────────────────────────────────────

describe('base32Encode / base32Decode', () => {
  // RFC 4648 §10 test vectors
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes "%s" → "%s"', (input, expected) => {
    expect(base32Encode(Buffer.from(input))).toBe(expected);
  });

  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('decodes "%s" → "%s"', (expected, encoded) => {
    expect(base32Decode(encoded).toString()).toBe(expected);
  });

  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0x00, 0xff, 0x10, 0xab, 0xcd]);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it('tolerates lowercase input', () => {
    expect(base32Decode('mzxw6ytboi').toString()).toBe('foobar');
  });

  it('tolerates spaces in input', () => {
    expect(base32Decode('MZXW 6YTB OI').toString()).toBe('foobar');
  });

  it('tolerates padding characters', () => {
    expect(base32Decode('MZXW6YTB OI======').toString()).toBe('foobar');
  });

  it('emits padding when requested', () => {
    const encoded = base32Encode(Buffer.from('foobar'), { padding: true });
    expect(encoded).toBe('MZXW6YTBOI======');
    expect(encoded.length % 8).toBe(0);
  });

  it('throws on invalid character', () => {
    expect(() => base32Decode('MZXW6!TB')).toThrow(/Invalid base32 character/);
  });

  it('throws on "8" which is not in RFC 4648 alphabet', () => {
    expect(() => base32Decode('MZXW6YTB8')).toThrow(/Invalid base32 character/);
  });
});

// ─── generateSecret ──────────────────────────────────────────────────────────

describe('generateSecret', () => {
  it('returns a base32 string of the right length for default 20 bytes', () => {
    const s = generateSecret();
    // 20 bytes → ceil(20*8/5) = 32 chars (no padding)
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBe(32);
  });

  it('respects byteLength parameter', () => {
    const s10 = generateSecret(10);
    // 10 bytes → ceil(10*8/5) = 16 chars
    expect(s10.length).toBe(16);

    const s32 = generateSecret(32);
    // 32 bytes → ceil(32*8/5) = 52 chars (no padding)
    expect(s32.length).toBe(Math.ceil((32 * 8) / 5));
  });

  it('returns different values on each call', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

// ─── HOTP – RFC 4226 Appendix D vectors ──────────────────────────────────────

describe('hotp – RFC 4226 Appendix D', () => {
  const vectors: [number, string][] = [
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ];

  it.each(vectors)('counter=%i → %s', (counter, expected) => {
    expect(hotp({ secret: RFC_SECRET_SHA1, counter })).toBe(expected);
  });

  it('works with BigInt counter', () => {
    expect(hotp({ secret: RFC_SECRET_SHA1, counter: BigInt(0) })).toBe('755224');
  });

  it('produces 8-digit result when digits=8', () => {
    // digits=8 changes the modulus, producing a different (wider) code
    const result = hotp({ secret: RFC_SECRET_SHA1, counter: 0, digits: 8 });
    expect(result).toBe('84755224');
    expect(result).toHaveLength(8);
  });
});

// ─── TOTP – RFC 6238 Appendix B vectors ──────────────────────────────────────

describe('totp – RFC 6238 Appendix B', () => {
  // All vectors use digits=8, period=30
  const sha1Vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  const sha256Vectors: [number, string][] = [
    [59, '46119246'],
    [1111111109, '68084774'],
    [1111111111, '67062674'],
    [1234567890, '91819424'],
    [2000000000, '90698825'],
    [20000000000, '77737706'],
  ];

  const sha512Vectors: [number, string][] = [
    [59, '90693936'],
    [1111111109, '25091201'],
    [1111111111, '99943326'],
    [1234567890, '93441116'],
    [2000000000, '38618901'],
    [20000000000, '47863826'],
  ];

  it.each(sha1Vectors)('SHA1 T=%i → %s', (time, expected) => {
    expect(
      totp({ secret: RFC_SECRET_SHA1, time, digits: 8, algorithm: 'SHA1' }),
    ).toBe(expected);
  });

  it.each(sha256Vectors)('SHA256 T=%i → %s', (time, expected) => {
    expect(
      totp({ secret: RFC_SECRET_SHA256, time, digits: 8, algorithm: 'SHA256' }),
    ).toBe(expected);
  });

  it.each(sha512Vectors)('SHA512 T=%i → %s', (time, expected) => {
    expect(
      totp({ secret: RFC_SECRET_SHA512, time, digits: 8, algorithm: 'SHA512' }),
    ).toBe(expected);
  });

  it('uses injected clock when time is omitted', () => {
    // clock returns ms, function divides by 1000 → T=59
    const result = totp({
      secret: RFC_SECRET_SHA1,
      digits: 8,
      algorithm: 'SHA1',
      clock: () => 59_000,
    });
    expect(result).toBe('94287082');
  });

  it('uses Date.now by default (smoke test — just produces a 6-digit string)', () => {
    const result = totp({ secret: RFC_SECRET_SHA1 });
    expect(result).toMatch(/^\d{6}$/);
  });
});

// ─── verifyTotp ───────────────────────────────────────────────────────────────

describe('verifyTotp', () => {
  const secret = RFC_SECRET_SHA1;
  // Fix time at T=1234567890 → counter = 41152263
  const time = 1234567890;

  it('returns ok=true for exact counter match (delta=0)', () => {
    const token = totp({ secret, time });
    const result = verifyTotp({ token, secret, time });
    expect(result).toEqual({ ok: true, delta: 0 });
  });

  it('accepts token from previous period (delta=-1)', () => {
    const token = totp({ secret, time: time - 30 });
    const result = verifyTotp({ token, secret, time, window: 1 });
    expect(result).toEqual({ ok: true, delta: -1 });
  });

  it('accepts token from next period (delta=+1)', () => {
    const token = totp({ secret, time: time + 30 });
    const result = verifyTotp({ token, secret, time, window: 1 });
    expect(result).toEqual({ ok: true, delta: 1 });
  });

  it('rejects token outside window', () => {
    const token = totp({ secret, time: time - 60 });
    const result = verifyTotp({ token, secret, time, window: 1 });
    expect(result.ok).toBe(false);
  });

  it('window=0 only accepts exact match', () => {
    const exact = totp({ secret, time });
    expect(verifyTotp({ token: exact, secret, time, window: 0 }).ok).toBe(true);

    const prev = totp({ secret, time: time - 30 });
    expect(verifyTotp({ token: prev, secret, time, window: 0 }).ok).toBe(false);
  });

  it('returns ok=false for completely wrong token', () => {
    expect(verifyTotp({ token: '000000', secret, time })).toEqual({ ok: false });
  });

  it('delta is correct for window=2', () => {
    const token = totp({ secret, time: time - 60 });
    const result = verifyTotp({ token, secret, time, window: 2 });
    expect(result).toEqual({ ok: true, delta: -2 });
  });

  it('uses injected clock when time omitted', () => {
    const token = totp({ secret, time });
    const result = verifyTotp({
      token,
      secret,
      clock: () => time * 1000,
    });
    expect(result.ok).toBe(true);
  });
});

// ─── verifyHotp ───────────────────────────────────────────────────────────────

describe('verifyHotp', () => {
  const secret = RFC_SECRET_SHA1;

  it('returns ok=true for exact counter match', () => {
    expect(verifyHotp({ token: '755224', secret, counter: 0 })).toEqual({
      ok: true,
      delta: 0,
    });
  });

  it('returns ok=true for counter+1 when window=1', () => {
    // counter=0 token is 755224; we verify at counter=0 with window=1 → delta=0
    // counter=1 token is 287082; verify at counter=0 with window=1 → delta=1
    expect(verifyHotp({ token: '287082', secret, counter: 0, window: 1 })).toEqual({
      ok: true,
      delta: 1,
    });
  });

  it('does NOT look backwards (forward-only)', () => {
    // token for counter=0 is 755224; verify at counter=1 → should fail (no backward check)
    expect(verifyHotp({ token: '755224', secret, counter: 1, window: 0 }).ok).toBe(false);
  });

  it('returns ok=false for wrong token', () => {
    expect(verifyHotp({ token: '000000', secret, counter: 0 }).ok).toBe(false);
  });

  it('window=2 finds token 2 steps ahead', () => {
    // counter=2 token is 359152; verify at counter=0 with window=2 → delta=2
    expect(verifyHotp({ token: '359152', secret, counter: 0, window: 2 })).toEqual({
      ok: true,
      delta: 2,
    });
  });

  it('default window=0 does not look forward', () => {
    expect(verifyHotp({ token: '287082', secret, counter: 0 }).ok).toBe(false);
  });
});

// ─── otpauthUri ──────────────────────────────────────────────────────────────

describe('otpauthUri', () => {
  it('generates a valid TOTP URI', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice@example.com',
      secret: RFC_SECRET_SHA1,
      issuer: 'Acme Corp',
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${RFC_SECRET_SHA1}`);
    expect(uri).toContain('issuer=Acme%20Corp');
  });

  it('prefixes issuer in label', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      issuer: 'MyApp',
    });
    expect(uri).toContain('MyApp:alice');
  });

  it('URL-encodes spaces in label', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'John Doe',
      secret: RFC_SECRET_SHA1,
    });
    expect(uri).toContain('John%20Doe');
  });

  it('URL-encodes spaces in issuer', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      issuer: 'My App',
    });
    expect(uri).toContain('My%20App');
    expect(uri).toContain('issuer=My%20App');
  });

  it('includes algorithm when specified', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      algorithm: 'SHA256',
    });
    expect(uri).toContain('algorithm=SHA256');
  });

  it('includes digits when specified', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      digits: 8,
    });
    expect(uri).toContain('digits=8');
  });

  it('includes period for TOTP when specified', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      period: 60,
    });
    expect(uri).toContain('period=60');
  });

  it('generates a valid HOTP URI with counter', () => {
    const uri = otpauthUri({
      type: 'hotp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      counter: 42,
    });
    expect(uri).toMatch(/^otpauth:\/\/hotp\//);
    expect(uri).toContain('counter=42');
  });

  it('does not include counter in TOTP URI', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      counter: 42,
    });
    expect(uri).not.toContain('counter=');
  });

  it('does not include period in HOTP URI', () => {
    const uri = otpauthUri({
      type: 'hotp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
      period: 30,
    });
    expect(uri).not.toContain('period=');
  });

  it('omits optional params when not provided', () => {
    const uri = otpauthUri({
      type: 'totp',
      label: 'alice',
      secret: RFC_SECRET_SHA1,
    });
    expect(uri).not.toContain('algorithm=');
    expect(uri).not.toContain('digits=');
    expect(uri).not.toContain('period=');
    expect(uri).not.toContain('issuer=');
  });
});
