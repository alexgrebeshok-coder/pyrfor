import { describe, expect, it } from 'vitest';
import { getBrowserQAReadiness } from './browser-readiness';

describe('Browser QA readiness', () => {
  it('reports missing Playwright as local-only unavailable readiness without live probes', () => {
    const snapshot = getBrowserQAReadiness({
      now: () => new Date('2026-05-05T00:00:00.000Z'),
      resolveModule: () => {
        throw new Error('missing module');
      },
    });

    expect(snapshot).toMatchObject({
      checkedAt: '2026-05-05T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      browserTool: expect.objectContaining({ name: 'browser', available: true }),
      playwright: { packageName: 'playwright', installed: false, chromiumInstalled: false, installHint: expect.stringContaining('playwright install chromium') },
      permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
      reasons: ['Playwright package is not installed for Browser QA.'],
    });
  });

  it('reports missing Chromium runtime when Playwright resolves but browser runtime is absent', () => {
    const snapshot = getBrowserQAReadiness({
      now: () => new Date('2026-05-05T00:00:00.000Z'),
      resolveModule: (moduleName) => `/node_modules/${moduleName}/index.js`,
      isChromiumRuntimeInstalled: () => false,
    });

    expect(snapshot).toMatchObject({
      status: 'unavailable',
      playwright: expect.objectContaining({ installed: true, chromiumInstalled: false }),
      reasons: ['Playwright Chromium runtime is not installed for Browser QA.'],
      nextStep: 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
    });
  });

  it('reports ready Browser QA prerequisites when local tool, permission, package and browser runtime are present', () => {
    const snapshot = getBrowserQAReadiness({
      now: () => new Date('2026-05-05T00:00:00.000Z'),
      resolveModule: (moduleName) => `/node_modules/${moduleName}/index.js`,
      isChromiumRuntimeInstalled: () => true,
    });

    expect(snapshot).toMatchObject({
      status: 'ready',
      browserTool: expect.objectContaining({
        available: true,
        actions: expect.arrayContaining(['screenshot', 'extract', 'click', 'type']),
      }),
      playwright: expect.objectContaining({ installed: true, chromiumInstalled: true }),
      reasons: ['Browser QA local prerequisites are configured.'],
      nextStep: 'Request Trust approval before running any live browser smoke or screenshot capture.',
    });
  });
});
