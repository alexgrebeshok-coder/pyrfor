/**
 * otp-totp.ts — RFC 4226 HOTP + RFC 6238 TOTP implementation.
 *
 * Provides:
 * - Base32 encode/decode (RFC 4648)
 * - HOTP (HMAC-based OTP) per RFC 4226
 * - TOTP (Time-based OTP) per RFC 6238
 * - Token verification with window support
 * - otpauth:// URI generation per Google Authenticator KeyURI spec
 *
 * Uses ONLY Node.js built-ins (crypto). No external dependencies.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ─── Base32 ──────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const BASE32_DECODE_MAP: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_DECODE_MAP[BASE32_ALPHABET[i]!] = i;
}

/** Encode a buffer as RFC 4648 base32. Padding omitted by default. */
export function base32Encode(
  buf: Buffer | Uint8Array,
  opts?: { padding?: boolean },
): string {
  const padding = opts?.padding ?? false;
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  if (padding) {
    while (result.length % 8 !== 0) {
      result += '=';
    }
  }

  return result;
}

/** Decode a RFC 4648 base32 string. Tolerates lowercase, spaces, and padding. */
export function base32Decode(str: string): Buffer {
  const clean = str.replace(/\s/g, '').toUpperCase().replace(/=/g, '');

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const charValue = BASE32_DECODE_MAP[char];
    if (charValue === undefined) {
      throw new Error(`Invalid base32 character: "${char}"`);
    }
    value = (value << 5) | charValue;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

/** Generate a cryptographically random base32 secret. */
export function generateSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface HotpOptions {
  /** Base32-encoded shared secret. */
  secret: string;
  counter: number | bigint;
  digits?: number;
  algorithm?: Algorithm;
}

export interface TotpOptions {
  secret: string;
  /** Unix timestamp in seconds. Defaults to clock()/1000. */
  time?: number;
  period?: number;
  digits?: number;
  algorithm?: Algorithm;
  t0?: number;
  /** Injectable clock for testability. Returns milliseconds (like Date.now). */
  clock?: () => number;
}

export interface VerifyResult {
  ok: boolean;
  /** Counter offset that matched. */
  delta?: number;
}

export interface VerifyTotpOptions {
  token: string;
  secret: string;
  period?: number;
  digits?: number;
  algorithm?: Algorithm;
  /** Number of periods to check on each side of current counter. */
  window?: number;
  time?: number;
  t0?: number;
  clock?: () => number;
}

export interface VerifyHotpOptions {
  token: string;
  secret: string;
  counter: number | bigint;
  digits?: number;
  algorithm?: Algorithm;
  /** Number of counter steps to check forward (inclusive). */
  window?: number;
}

export interface OtpauthUriOptions {
  type: 'totp' | 'hotp';
  label: string;
  secret: string;
  issuer?: string;
  algorithm?: Algorithm;
  digits?: number;
  period?: number;
  counter?: number;
}

// ─── HOTP ────────────────────────────────────────────────────────────────────

/**
 * Compute an HOTP value per RFC 4226.
 * @returns Zero-padded numeric string of length `digits`.
 */
export function hotp({
  secret,
  counter,
  digits = 6,
  algorithm = 'SHA1',
}: HotpOptions): string {
  const keyBytes = base32Decode(secret);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(algorithm.toLowerCase(), keyBytes);
  hmac.update(counterBuf);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  const otp = code % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

// ─── TOTP ────────────────────────────────────────────────────────────────────

/**
 * Compute a TOTP value per RFC 6238.
 */
export function totp({
  secret,
  time,
  period = 30,
  digits = 6,
  algorithm = 'SHA1',
  t0 = 0,
  clock = Date.now,
}: TotpOptions): string {
  const t = time ?? clock() / 1000;
  const counter = Math.floor((t - t0) / period);
  return hotp({ secret, counter, digits, algorithm });
}

// ─── Verify ──────────────────────────────────────────────────────────────────

/** Constant-time comparison of two strings of the same length. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify a TOTP token, checking `window` periods on each side of the current counter.
 */
export function verifyTotp({
  token,
  secret,
  period = 30,
  digits = 6,
  algorithm = 'SHA1',
  window = 1,
  time,
  t0 = 0,
  clock = Date.now,
}: VerifyTotpOptions): VerifyResult {
  const t = time ?? clock() / 1000;
  const counter = Math.floor((t - t0) / period);

  for (let delta = -window; delta <= window; delta++) {
    const candidate = hotp({ secret, counter: counter + delta, digits, algorithm });
    if (safeEqual(token.padStart(digits, '0'), candidate)) {
      return { ok: true, delta };
    }
  }

  return { ok: false };
}

/**
 * Verify an HOTP token, checking `window` counter steps forward from `counter`.
 */
export function verifyHotp({
  token,
  secret,
  counter,
  digits = 6,
  algorithm = 'SHA1',
  window = 0,
}: VerifyHotpOptions): VerifyResult {
  const base = Number(counter);
  for (let delta = 0; delta <= window; delta++) {
    const candidate = hotp({ secret, counter: base + delta, digits, algorithm });
    if (safeEqual(token.padStart(digits, '0'), candidate)) {
      return { ok: true, delta };
    }
  }
  return { ok: false };
}

// ─── otpauth URI ─────────────────────────────────────────────────────────────

/**
 * Generate an otpauth:// URI per Google Authenticator KeyURI spec.
 * Label is prefixed with issuer when issuer is present.
 */
export function otpauthUri({
  type,
  label,
  secret,
  issuer,
  algorithm,
  digits,
  period,
  counter,
}: OtpauthUriOptions): string {
  const encodedLabel = issuer
    ? `${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`
    : encodeURIComponent(label);

  const params: string[] = [];
  params.push(`secret=${encodeURIComponent(secret)}`);
  if (issuer !== undefined) params.push(`issuer=${encodeURIComponent(issuer)}`);
  if (algorithm !== undefined) params.push(`algorithm=${encodeURIComponent(algorithm)}`);
  if (digits !== undefined) params.push(`digits=${digits}`);
  if (type === 'totp' && period !== undefined) params.push(`period=${period}`);
  if (type === 'hotp' && counter !== undefined) params.push(`counter=${counter}`);

  return `otpauth://${type}/${encodedLabel}?${params.join('&')}`;
}
