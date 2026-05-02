// @vitest-environment node

import { describe, expect, it, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ContextCompiler } from './context-compiler';
import {
  DomainOverlayRegistry,
  type DomainOverlayManifest,
  mergeContextFacts,
} from './domain-overlay';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { PermissionEngine, ToolRegistry, registerStandardTools } from './permission-engine';
import { TwoPhaseEffectRunner } from './two-phase-effect';

function tmpDir(): string {
  return path.join(os.tmpdir(), `domain-overlay-test-${randomBytes(8).toString('hex')}`);
}

function ochagManifest(): DomainOverlayManifest {
  return {
    schemaVersion: 'domain_overlay.v1',
    domainId: 'ochag',
    version: '0.1.0',
    title: 'Ochag family operations',
    privacyRules: [
      {
        id: 'member-private-context',
        appliesTo: 'context',
        effect: 'redact',
        note: 'Do not leak member-private memory into family/global context.',
      },
    ],
    toolPermissionOverrides: {
      apply_patch: 'deny',
    },
    staticPolicyFacts: [
      { id: 'ochag:policy:approval', content: 'Ask before sensitive family escalations.' },
    ],
    staticDomainFacts: [
      { id: 'ochag:domain:roles', content: { roles: ['owner', 'adult', 'teen'] } },
    ],
    workflowTemplates: [
      {
        id: 'family-reminder',
        title: 'Family reminder',
        taskSchemaId: 'family-task',
        nodes: [
          { id: 'plan', kind: 'ochag.plan_reminder' },
          { id: 'notify', kind: 'ochag.notify_family', dependsOn: ['plan'] },
        ],
      },
    ],
  };
}

describe('DomainOverlayRegistry', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('rejects duplicate domainId', () => {
    const registry = new DomainOverlayRegistry();
    registry.register({ manifest: ochagManifest() });

    expect(() => registry.register({ manifest: ochagManifest() })).toThrow(/duplicate domainId/);
  });

  it('merges and sorts context facts deterministically', () => {
    const facts = mergeContextFacts([
      { id: 'b', content: 2 },
      { id: 'a', content: 1 },
      { id: 'b', content: 3 },
    ]);

    expect(facts.map((fact) => [fact.id, fact.content])).toEqual([
      ['a', 1],
      ['b', 3],
    ]);
  });

  it('enriches ContextCompiler input with overlay policy/domain facts', async () => {
    const registry = new DomainOverlayRegistry();
    registry.register({
      manifest: ochagManifest(),
      hooks: {
        buildPolicyFacts: async () => [
          { id: 'ochag:policy:dynamic', content: 'Dynamic family policy' },
        ],
        buildDomainFacts: () => [
          { id: 'ochag:domain:dynamic', content: 'Dynamic family fact' },
        ],
      },
    });

    const enriched = await registry.enrichCompileInput(
      {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        compiledAt: '2026-05-01T00:00:00.000Z',
        task: { id: 'task-1', title: 'Coordinate family reminder' },
      },
      { domainIds: ['ochag'] },
    );
    const result = await new ContextCompiler().compile(enriched);

    const policy = result.pack.sections.find((section) => section.id === 'policy');
    const domain = result.pack.sections.find((section) => section.id === 'domain_facts');
    expect(JSON.stringify(policy?.content)).toContain('member-private-context');
    expect(JSON.stringify(policy?.content)).toContain('Dynamic family policy');
    expect(JSON.stringify(domain?.content)).toContain('Dynamic family fact');
  });

  it('materializes workflow templates into DurableDag nodes', () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const registry = new DomainOverlayRegistry();
    registry.register({ manifest: ochagManifest() });
    const dag = new DurableDag({ storePath: path.join(root, 'dag.json') });

    for (const node of registry.instantiateWorkflow('ochag', 'family-reminder')) {
      dag.addNode(node);
    }

    const nodes = dag.listNodes();
    expect(nodes.map((node) => node.id)).toEqual([
      'ochag/family-reminder/notify',
      'ochag/family-reminder/plan',
    ]);
    expect(nodes.find((node) => node.id.endsWith('/notify'))?.dependsOn).toEqual([
      'ochag/family-reminder/plan',
    ]);
    expect(nodes.find((node) => node.id.endsWith('/plan'))?.payload).toMatchObject({
      domainId: 'ochag',
      templateId: 'family-reminder',
      taskSchemaId: 'family-task',
    });
  });

  it('feeds overlay toolPermissionOverrides into TwoPhaseEffectRunner policy decisions', async () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const registry = new DomainOverlayRegistry();
    registry.register({ manifest: ochagManifest() });
    const tools = new ToolRegistry();
    registerStandardTools(tools);
    const permissionEngine = new PermissionEngine(tools, {
      overrides: registry.resolveToolPermissionOverrides(['ochag']),
    });
    const ledger = new EventLedger(path.join(root, 'events.jsonl'));
    const runner = new TwoPhaseEffectRunner({
      ledger,
      permissionEngine,
      permissionContext: { workspaceId: 'workspace-1', sessionId: 'session-1' },
    });

    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'file_edit',
      payload: { path: 'family.md' },
      preview: 'Edit family plan',
    });
    const verdict = await runner.decide(effect);

    expect(verdict).toMatchObject({
      decision: 'deny',
      policy_id: 'permission:deny',
      approval_required: false,
    });
    await ledger.close();
  });
});
