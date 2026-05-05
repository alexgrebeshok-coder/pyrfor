import { describe, expect, it, vi } from 'vitest';
import {
  buildBrowserSmokeApprovalId,
  normalizeBrowserSmokeInput,
  runBrowserSmokeCapture,
} from './browser-smoke';
import type { BrowserController, BrowserLauncher } from './browser-control';

function fakeController(): BrowserController {
  return {
    launch: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    newPage: vi.fn(async () => {
      throw new Error('unused');
    }),
    navigate: vi.fn(async () => ({
      ok: true,
      data: {
        url: 'http://localhost:5173/app?token=secret&ok=1#ignored',
        title: 'Pyrfor token=secret',
      },
      durationMs: 3,
    })),
    click: vi.fn(),
    type: vi.fn(),
    getText: vi.fn(async () => ({ ok: true, data: 'Pyrfor is ready', durationMs: 1 })),
    screenshot: vi.fn(async () => ({ ok: true, data: Buffer.from('png-bytes'), durationMs: 2 })),
    evaluate: vi.fn(),
    isLaunched: vi.fn(() => true),
    on: vi.fn(() => () => {}),
  };
}

describe('browser-smoke', () => {
  it('normalizes localhost-only smoke requests and hashes unsafe target details', () => {
    const normalized = normalizeBrowserSmokeInput({
      url: 'http://localhost:5173/app?token=secret&ok=1#fragment',
      assertion: { selector: '#status', containsText: 'Ready' },
      fullPage: true,
    });

    expect(normalized.publicUrl).toBe('http://localhost:5173/app?token=redacted&ok=1');
    expect(normalized.urlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized.assertion?.containsText).toBe('Ready');
    expect(normalized.assertion?.containsTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildBrowserSmokeApprovalId(normalized, 'run-1')).toMatch(/^browser-smoke:[a-f0-9]{24}$/);
  });

  it('rejects external and credential-bearing targets before launching a browser', async () => {
    expect(() => normalizeBrowserSmokeInput({ url: 'https://example.com' })).toThrow('only localhost');
    expect(() => normalizeBrowserSmokeInput({ url: 'http://user:pass@localhost:5173/app' })).toThrow('embedded credentials');

    const controller = fakeController();
    await expect(runBrowserSmokeCapture('run-1', {
      url: 'https://example.com',
      approvalId: 'approval-1',
    }, { controller })).rejects.toThrow('only localhost');
    expect(controller.launch).not.toHaveBeenCalled();
  });

  it('captures sanitized browser smoke evidence without storing raw assertion text', async () => {
    const controller = fakeController();
    const captured = await runBrowserSmokeCapture('run-1', {
      url: 'http://localhost:5173/app?token=secret&ok=1',
      assertion: { selector: '#status', containsText: 'READY' },
      approvalId: 'approval-1',
      notes: ['apiKey=secret'],
    }, {
      controller,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(captured.snapshot).toMatchObject({
      schemaVersion: 'pyrfor.browser_smoke.v1',
      createdAt: '2026-05-05T00:00:00.000Z',
      runId: 'run-1',
      status: 'failed',
      sourceMode: 'governed_browser_smoke',
      targetHost: 'localhost:5173',
      targetPathHash: expect.any(String),
      finalHost: 'localhost:5173',
      finalUrlHash: expect.any(String),
      title: 'Pyrfor token=[redacted]',
      assertion: expect.objectContaining({
        selector: '#status',
        matched: false,
        containsTextHash: expect.any(String),
      }),
      effectsExecuted: [expect.objectContaining({
        kind: 'browser_smoke',
        approvalId: 'approval-1',
      })],
      notes: ['apiKey=[redacted]'],
    });
    expect(JSON.stringify(captured.snapshot)).not.toContain('READY');
    expect(JSON.stringify(captured.snapshot)).not.toContain('secret');
    expect(JSON.stringify(captured.snapshot)).not.toContain('/app');
    expect(JSON.stringify(captured.snapshot)).not.toContain('ok=1');
    expect(captured.screenshot.toString('utf8')).toBe('png-bytes');
    expect(controller.close).toHaveBeenCalled();
  });

  it('rejects external redirects before DOM reads or screenshots', async () => {
    const controller = fakeController();
    vi.mocked(controller.navigate).mockResolvedValueOnce({
      ok: true,
      data: { url: 'https://example.com/redirected', title: 'External' },
      durationMs: 1,
    });

    await expect(runBrowserSmokeCapture('run-1', {
      url: 'http://localhost:5173/app',
      assertion: { selector: '#status', containsText: 'Ready' },
      approvalId: 'approval-1',
    }, { controller })).rejects.toThrow('only localhost');

    expect(controller.getText).not.toHaveBeenCalled();
    expect(controller.screenshot).not.toHaveBeenCalled();
    expect(controller.close).toHaveBeenCalled();
  });

  it('launches Playwright-backed smoke with an allowed host guard', async () => {
    let launchAllowedHosts: string[] | undefined;
    const launcher: BrowserLauncher = vi.fn(async (opts) => {
      launchAllowedHosts = opts.allowedHosts;
      return {
        newPage: async () => ({
          goto: async () => {},
          click: async () => {},
          type: async () => {},
          fill: async () => {},
          getText: async () => 'Ready',
          innerHTML: async () => '<main>Ready</main>',
          evaluate: async () => null,
          screenshot: async () => Buffer.from('png-bytes'),
          waitForSelector: async () => {},
          url: () => 'http://localhost:5173/app',
          title: async () => 'Pyrfor',
          close: async () => {},
        }),
        close: async () => {},
      };
    });

    await runBrowserSmokeCapture('run-1', {
      url: 'http://localhost:5173/app',
      approvalId: 'approval-1',
    }, { launcher });

    expect(launchAllowedHosts).toEqual(['localhost:5173']);
  });
});
