// @vitest-environment node
/**
 * Tests for auth-tokens — bearer-token validator with rotation support.
 */

import { describe, it, expect } from 'vitest';
import { createTokenValidator } from './auth-tokens';

// ─── Open mode ────────────────────────────────────────────────────────────

describe('createTokenValidator — open mode (no tokens configured)', () => {
  it('returns ok:true for any token when no tokens are configured', () => {
    const v = createTokenValidator({});
    expect(v.validate('anything')).toEqual({ ok: true });
    expect(v.validate('')).toEqual({ ok: true });
  });

  it('returns ok:true when bearerTokens is explicitly empty array', () => {
    const v = createTokenValidator({ bearerTokens: [] });
    expect(v.validate('any')).toEqual({ ok: true });
  });
});

// ─── Legacy single token ─────────────────────────────────────────────────

describe('createTokenValidator — legacy bearerToken', () => {
  const TOKEN = 'supersecrettoken';

  it('accepts the correct legacy token', () => {
    const v = createTokenValidator({ bearerToken: TOKEN });
    const result = v.validate(TOKEN);
    expect(result.ok).toBe(true);
    expect(result.label).toBe('legacy');
  });

  it('rejects a wrong token with reason unknown', () => {
    const v = createTokenValidator({ bearerToken: TOKEN });
    const result = v.validate('wrongtoken!!');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown');
  });

  it('rejects an empty token', () => {
    const v = createTokenValidator({ bearerToken: TOKEN });
    const result = v.validate('');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown');
  });
});

// ─── Multiple tokens ──────────────────────────────────────────────────────

describe('createTokenValidator — multiple bearerTokens', () => {
  const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 86_400_000).toISOString();

  it('accepts a valid non-expired token', () => {
    const v = createTokenValidator({
      bearerTokens: [{ value: 'validtoken1', label: 'primary', expiresAt: FUTURE }],
    });
    expect(v.validate('validtoken1')).toMatchObject({ ok: true, label: 'primary' });
  });

  it('accepts a token with no expiry', () => {
    const v = createTokenValidator({
      bearerTokens: [{ value: 'neverexpires', label: 'permanent' }],
    });
    expect(v.validate('neverexpires')).toMatchObject({ ok: true, label: 'permanent' });
  });

  it('rejects an expired token with reason expired', () => {
    const v = createTokenValidator({
      bearerTokens: [{ value: 'oldtoken1234', label: 'old', expiresAt: PAST }],
    });
    const result = v.validate('oldtoken1234');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.label).toBe('old');
  });

  it('expired token rejected, valid token accepted (mixed list)', () => {
    const v = createTokenValidator({
      bearerTokens: [
        { value: 'expiredtoken', label: 'old', expiresAt: PAST },
        { value: 'activetoken1', label: 'current' },
      ],
    });
    expect(v.validate('expiredtoken')).toMatchObject({ ok: false, reason: 'expired' });
    expect(v.validate('activetoken1')).toMatchObject({ ok: true, label: 'current' });
  });

  it('rejects a completely unknown token with reason unknown', () => {
    const v = createTokenValidator({
      bearerTokens: [{ value: 'knowntoken11' }],
    });
    expect(v.validate('unknowntoken')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

// ─── Now injection for deterministic expiry ───────────────────────────────

describe('createTokenValidator — now injection', () => {
  const TOKEN_VALUE = 'mytesttoken1';
  const EXPIRY = '2024-06-01T00:00:00.000Z';

  it('treats token as valid when injected now is before expiry', () => {
    const now = () => new Date('2024-05-31T23:59:59.999Z');
    const v = createTokenValidator(
      { bearerTokens: [{ value: TOKEN_VALUE, expiresAt: EXPIRY }] },
      { now },
    );
    expect(v.validate(TOKEN_VALUE)).toMatchObject({ ok: true });
  });

  it('treats token as expired when injected now is exactly at expiry', () => {
    const now = () => new Date(EXPIRY);
    const v = createTokenValidator(
      { bearerTokens: [{ value: TOKEN_VALUE, expiresAt: EXPIRY }] },
      { now },
    );
    expect(v.validate(TOKEN_VALUE)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('treats token as expired when injected now is after expiry', () => {
    const now = () => new Date('2024-06-02T00:00:00.000Z');
    const v = createTokenValidator(
      { bearerTokens: [{ value: TOKEN_VALUE, expiresAt: EXPIRY }] },
      { now },
    );
    expect(v.validate(TOKEN_VALUE)).toMatchObject({ ok: false, reason: 'expired' });
  });
});

// ─── Constant-time path (length mismatch safety) ─────────────────────────

describe('createTokenValidator — constant-time comparison', () => {
  it('does not throw when candidate is shorter than stored token', () => {
    const v = createTokenValidator({ bearerTokens: [{ value: 'longertokenvalue' }] });
    expect(() => v.validate('short')).not.toThrow();
    expect(v.validate('short').ok).toBe(false);
  });

  it('does not throw when candidate is longer than stored token', () => {
    const v = createTokenValidator({ bearerTokens: [{ value: 'short123' }] });
    expect(() => v.validate('verylongtokenvaluehere')).not.toThrow();
    expect(v.validate('verylongtokenvaluehere').ok).toBe(false);
  });

  it('does not throw for empty candidate string', () => {
    const v = createTokenValidator({ bearerTokens: [{ value: 'nonempty1' }] });
    expect(() => v.validate('')).not.toThrow();
    expect(v.validate('').ok).toBe(false);
  });

  it('accepts same-length token that actually matches', () => {
    const v = createTokenValidator({ bearerTokens: [{ value: 'exactmatch1' }] });
    expect(v.validate('exactmatch1')).toMatchObject({ ok: true });
  });

  it('rejects same-length token that does not match', () => {
    const v = createTokenValidator({ bearerTokens: [{ value: 'exactmatch1' }] });
    expect(v.validate('exactmatch2')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

// ─── Legacy + bearerTokens coexistence ───────────────────────────────────

describe('createTokenValidator — legacy + bearerTokens together', () => {
  it('accepts legacy token when both are configured', () => {
    const v = createTokenValidator({
      bearerToken: 'legacytoken1',
      bearerTokens: [{ value: 'newtoken1234', label: 'new' }],
    });
    expect(v.validate('legacytoken1')).toMatchObject({ ok: true, label: 'legacy' });
    expect(v.validate('newtoken1234')).toMatchObject({ ok: true, label: 'new' });
  });

  it('rejects unknown token when both are configured', () => {
    const v = createTokenValidator({
      bearerToken: 'legacytoken1',
      bearerTokens: [{ value: 'newtoken1234' }],
    });
    expect(v.validate('completely-wrong')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});
