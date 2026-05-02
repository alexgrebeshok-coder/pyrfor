// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ContextCompiler } from './context-compiler';
import {
  createCeoclawOverlayManifest,
  createOchagOverlayManifest,
  registerDefaultDomainOverlays,
} from './domain-overlay-presets';

describe('domain overlay presets', () => {
  it('creates valid Ochag and CEOClaw manifests', () => {
    const registry = registerDefaultDomainOverlays();

    expect(registry.list().map((overlay) => overlay.domainId)).toEqual(['ceoclaw', 'ochag']);
    expect(registry.get('ochag')?.manifest.workflowTemplates?.map((template) => template.id)).toContain('family-reminder');
    expect(registry.get('ceoclaw')?.manifest.workflowTemplates?.map((template) => template.id)).toContain('evidence-approval');
  });

  it('materializes preset workflows into prefixed DAG nodes', () => {
    const registry = registerDefaultDomainOverlays();

    const ochagNodes = registry.instantiateWorkflow('ochag', 'family-reminder');
    expect(ochagNodes.map((node) => node.id)).toEqual([
      'ochag/family-reminder/classify',
      'ochag/family-reminder/notify',
      'ochag/family-reminder/privacy-check',
      'ochag/family-reminder/schedule',
    ]);
    expect(ochagNodes.find((node) => node.id.endsWith('/notify'))?.dependsOn).toEqual([
      'ochag/family-reminder/schedule',
    ]);

    const ceoclawNodes = registry.instantiateWorkflow('ceoclaw', 'evidence-approval');
    expect(ceoclawNodes.find((node) => node.id.endsWith('/approval'))?.timeoutClass).toBe('manual');
  });

  it('feeds preset policy and domain facts into deterministic context packs', async () => {
    const registry = registerDefaultDomainOverlays();
    const enriched = await registry.enrichCompileInput(
      {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        compiledAt: '2026-05-01T00:00:00.000Z',
        task: { id: 'task-1', title: 'Plan household reminder and project evidence approval' },
      },
      { domainIds: ['ochag', 'ceoclaw'] },
    );
    const result = await new ContextCompiler().compile(enriched);
    const text = JSON.stringify(result.pack);

    expect(text).toContain('Family/global context must not include member-private memory');
    expect(text).toContain('1C/ERP integration is read-only');
    expect(text).toContain('ceoclaw:domain:golden-workflow');
    expect(text).toContain('ochag:domain:roles');
  });

  it('encodes expected permission overrides', () => {
    expect(createOchagOverlayManifest().toolPermissionOverrides).toMatchObject({
      telegram_send: 'ask_once',
      secrets_access: 'deny',
    });
    expect(createCeoclawOverlayManifest().toolPermissionOverrides).toMatchObject({
      network_write: 'deny',
      deploy: 'deny',
    });
  });

  it('exposes Ochag privacy facts, permissions and reminder workflow payload', async () => {
    const registry = registerDefaultDomainOverlays();
    const facts = await registry.resolveContextFacts(['ochag']);

    expect(facts.policyFacts.map((fact) => fact.id)).toEqual(expect.arrayContaining([
      'ochag:privacy:member-private-memory',
      'ochag:privacy:sensitive-family-action',
      'ochag:privacy:family-visibility-boundary',
      'ochag:tool-permission:telegram_send',
      'ochag:tool-permission:memory_write',
      'ochag:tool-permission:secrets_access',
    ]));
    expect(registry.resolveToolPermissionOverrides(['ochag'])).toEqual({
      telegram_send: 'ask_once',
      memory_write: 'ask_once',
      secrets_access: 'deny',
    });
    expect(registry.instantiateWorkflow('ochag', 'family-reminder', {
      payload: { familyId: 'fam-1', audience: 'parents', visibility: 'family' },
    })[0]?.payload).toMatchObject({
      domainId: 'ochag',
      templateId: 'family-reminder',
      taskSchemaId: 'ochag.family_task',
      familyId: 'fam-1',
      audience: 'parents',
      visibility: 'family',
    });
  });

  it('exposes CEOClaw workflows, adapters and guarded permissions', () => {
    const manifest = createCeoclawOverlayManifest();
    expect(manifest.workflowTemplates?.map((template) => template.id)).toEqual(expect.arrayContaining([
      'evidence-approval',
      'one-c-readonly-sync',
    ]));
    expect(manifest.adapterRegistrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one-c-readonly' }),
      expect.objectContaining({ id: 'telegram-field-ops' }),
      expect.objectContaining({ id: 'ceoclaw-mcp' }),
    ]));
    expect(manifest.toolPermissionOverrides).toMatchObject({
      network_write: 'deny',
      secrets_access: 'ask_every_time',
      deploy: 'deny',
    });

    const registry = registerDefaultDomainOverlays();
    expect(registry.instantiateWorkflow('ceoclaw', 'one-c-readonly-sync')
      .find((node) => node.kind === 'ceoclaw.one_c_readonly')?.retryClass).toBe('transient');
    expect(registry.instantiateWorkflow('ceoclaw', 'evidence-approval')
      .find((node) => node.kind === 'ceoclaw.request_approval')).toMatchObject({
        timeoutClass: 'manual',
        retryClass: 'human_needed',
      });
  });
});
