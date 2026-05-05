// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildResearchSourceCaptureApprovalId,
  normalizeResearchSourceCaptureInput,
  runResearchSourceCapture,
} from './research-source-capture';

describe('research-source-capture', () => {
  it('normalizes public URLs, strips fragments and redacts sensitive query params', () => {
    const normalized = normalizeResearchSourceCaptureInput({
      url: 'https://example.com/docs/path?token=secret&topic=pyrfor#frag',
      note: 'safe note',
    });
    expect(normalized.url).toBe('https://example.com/docs/path?token=secret&topic=pyrfor');
    expect(normalized.publicUrl).toBe('https://example.com/redacted-path?token=redacted&topic=pyrfor');
    expect(normalized.urlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized.pathHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildResearchSourceCaptureApprovalId(normalized, 'run-1')).toMatch(/^research-source:[a-f0-9]{24}$/);
  });

  it('rejects embedded credentials and local/private network targets', () => {
    expect(() => normalizeResearchSourceCaptureInput({ url: 'https://user:pass@example.com/' })).toThrow(/embedded credentials/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://localhost:3000/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://127.0.0.1:3000/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://10.0.0.5/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://[::1]/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://[::ffff:127.0.0.1]/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://[::ffff:7f00:1]/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://[fc00::1]/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'http://[fe80::1]/' })).toThrow(/private-network/);
    expect(() => normalizeResearchSourceCaptureInput({ url: 'file:///etc/passwd' })).toThrow(/http or https/);
  });

  it('follows only safe redirects and blocks local redirect targets before fetching them', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://example.com/start') {
        return new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        });
      }
      return new Response('leak', { status: 200, headers: { 'content-type': 'text/plain' } });
    });

    await expect(runResearchSourceCapture('run-1', {
      url: 'https://example.com/start',
      approvalId: 'research-source:approval',
    }, {
      fetchImpl,
      resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    })).rejects.toThrow(/private-network/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks public hostnames that resolve to private-network addresses before fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('leak', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    await expect(runResearchSourceCapture('run-1', {
      url: 'https://private.example.test/source',
      approvalId: 'research-source:approval',
    }, {
      fetchImpl,
      resolveHostname: async () => [{ address: '127.0.0.1', family: 4 }],
    })).rejects.toThrow(/DNS resolved to a local or private-network target/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('captures bounded text/html evidence without exposing full content in the snapshot', async () => {
    const body = '<html><head><title>Example</title></head><body>hello token=secret world</body></html>';
    const result = await runResearchSourceCapture('run-1', {
      url: 'https://example.com/article?apiKey=secret',
      approvalId: 'research-source:approval',
    }, {
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
      resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(result.snapshot.finalUrl).toBe('https://example.com/redacted-path?apiKey=redacted');
    expect(result.snapshot.finalUrl).not.toContain('/article');
    expect(result.snapshot.title).toBe('Example');
    expect(result.snapshot.excerpt).toContain('hello token=[redacted] world');
    expect(result.artifactDocument.contentText).toContain('hello token=[redacted] world');
    expect(JSON.stringify(result.snapshot)).not.toContain('contentText');
    expect(result.snapshot.effectsExecuted[0]?.approvalId).toBe('research-source:approval');
  });

  it('rejects binary content types', async () => {
    await expect(runResearchSourceCapture('run-1', {
      url: 'https://example.com/file.pdf',
      approvalId: 'research-source:approval',
    }, {
      fetchImpl: async () => new Response('pdf', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
      resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    })).rejects.toThrow(/text\/html and text\/plain/);
  });
});
