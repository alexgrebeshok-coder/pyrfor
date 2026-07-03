// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertOutboundUrlAllowedResolved, UrlPolicyError } from '../url-policy.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';

const lookupMock = vi.mocked(lookup);

describe('P0-5 DNS rebinding guard', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);

    await expect(assertOutboundUrlAllowedResolved('https://rebind.example/page')).rejects.toThrow(
      UrlPolicyError,
    );
    await expect(assertOutboundUrlAllowedResolved('https://rebind.example/page')).rejects.toThrow(
      /resolved address/i,
    );
  });

  it('allows hostnames that resolve to public addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

    const parsed = await assertOutboundUrlAllowedResolved('https://example.com/page');
    expect(parsed.hostname).toBe('example.com');
  });

  it('skips DNS lookup for literal public IPs', async () => {
    const parsed = await assertOutboundUrlAllowedResolved('https://93.184.216.34/page');
    expect(parsed.hostname).toBe('93.184.216.34');
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
