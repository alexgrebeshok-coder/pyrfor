// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildProductFactoryActorSeeds, createDefaultProductFactory } from './product-factory';

describe('ProductFactory', () => {
  it('exposes canonical product intent templates', () => {
    const factory = createDefaultProductFactory();

    expect(factory.listTemplates().map((template) => template.id)).toEqual([
      'feature',
      'refactor',
      'bugfix',
      'bot_workflow',
      'ochag_family_reminder',
      'business_brief',
      'ui_scaffold',
    ]);
    expect(factory.getTemplate('bot_workflow')).toMatchObject({
      recommendedDomainIds: ['ochag'],
    });
    expect(factory.getTemplate('business_brief')).toMatchObject({
      recommendedDomainIds: ['ceoclaw'],
    });
  });

  it('drafts clarification gaps, scoped plan, DAG preview and delivery checklist deterministically', () => {
    const factory = createDefaultProductFactory({
      getReleaseReadiness: () => ({
        checkedAt: '2026-05-05T00:00:00.000Z',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        status: 'ready',
        secrets: [],
        artifacts: [],
        contracts: [],
        reasons: ['Local release prerequisites are configured.'],
        nextStep: 'Run the release check and tagged release workflow when ready to cut a signed build.',
      }),
    });
    const preview = factory.previewPlan({
      templateId: 'feature',
      prompt: 'Add operator delivery package for finished worker runs',
      answers: {
        acceptance: 'Run details show summary, changed files and tests.',
      },
    });

    expect(preview.intent).toMatchObject({
      templateId: 'feature',
      title: 'Add operator delivery package for finished worker runs',
    });
    expect(preview.missingClarifications.map((item) => item.id)).toEqual(['surface']);
    expect(preview.scopedPlan.scope[0]).toContain('Run details show summary');
    expect(preview.deliveryChecklist).toContain('deployment_checklist');
    expect(preview.scopedPlan.qualityGates).toContain('release_readiness');
    expect(preview.qualityGateReadiness).toEqual([
      {
        gate: 'release_readiness',
        status: 'ready',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        reasons: ['Local release prerequisites are configured.'],
        nextStep: 'Run the release check and tagged release workflow when ready to cut a signed build.',
      },
    ]);
    expect(preview.actorWorkflow).toMatchObject({
      enabled: true,
      recommendedModel: 'gpt-5.4',
      actors: [
        { actorId: 'product-planner', role: 'planner', messageCount: 1, dependsOn: [] },
        { actorId: 'product-implementer', role: 'implementer', messageCount: 1, dependsOn: ['product-planner'] },
        { actorId: 'product-reviewer', role: 'reviewer', messageCount: 1, dependsOn: ['product-implementer'] },
      ],
    });
    expect(preview.dagPreview.nodes.map((node) => node.kind)).toEqual([
      'product_factory.clarify_scope',
      'product_factory.compile_context',
      'product_factory.scoped_plan',
      'product_factory.worker_execution',
      'product_factory.verify',
      'product_factory.delivery_package',
    ]);
    expect(preview.dagPreview.nodes.find((node) => node.kind === 'product_factory.deliver')?.dependsOn).toBeUndefined();
    expect(preview.dagPreview.nodes.find((node) => node.kind === 'product_factory.delivery_package')?.dependsOn).toEqual([
      expect.stringContaining('/verify'),
    ]);
  });

  it('adds local-only Browser QA readiness for UI scaffold browser smoke gates', () => {
    const factory = createDefaultProductFactory({
      getBrowserReadiness: () => ({
        checkedAt: '2026-05-05T00:00:00.000Z',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        status: 'unavailable',
        browserTool: { name: 'browser', available: true, actions: ['screenshot', 'extract'] },
        playwright: {
          packageName: 'playwright',
          installed: true,
          chromiumInstalled: false,
          installHint: 'Install Playwright Chromium',
        },
        permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
        reasons: ['Playwright Chromium runtime is not installed for Browser QA.'],
        nextStep: 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
      }),
    });

    const preview = factory.previewPlan({
      templateId: 'ui_scaffold',
      prompt: 'Build settings panel empty state',
      answers: {
        users: 'Operators',
        states: 'loading, empty, success, error',
      },
    });

    expect(preview.scopedPlan.qualityGates).toContain('browser_smoke');
    expect(preview.actorWorkflow).toMatchObject({
      enabled: false,
      actors: [],
      nextStep: 'This template does not seed Product Factory actor mailbox work.',
    });
    expect(preview.qualityGateReadiness).toEqual([
      {
        gate: 'browser_smoke',
        status: 'setup_required',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        reasons: ['Playwright Chromium runtime is not installed for Browser QA.'],
        nextStep: 'Install missing local Browser QA prerequisites before requesting browser smoke approval.',
      },
    ]);
  });

  it('maps unavailable release readiness into feature setup-required gate without affecting UI scaffold gates', () => {
    const factory = createDefaultProductFactory({
      getBrowserReadiness: () => ({
        checkedAt: '2026-05-05T00:00:00.000Z',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        status: 'ready',
        browserTool: { name: 'browser', available: true, actions: ['screenshot'] },
        playwright: { packageName: 'playwright', installed: true, chromiumInstalled: true },
        permission: { toolName: 'browser_navigate', permissionClass: 'ask_once', sideEffect: 'network' },
        reasons: ['Browser QA local prerequisites are configured.'],
        nextStep: 'Request Trust approval before running Browser QA.',
      }),
      getReleaseReadiness: () => ({
        checkedAt: '2026-05-05T00:00:00.000Z',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        status: 'unavailable',
        secrets: [{ name: 'APPLE_ID', configured: false }],
        artifacts: [],
        contracts: [],
        reasons: ['Release secret env is missing: APPLE_ID.'],
        nextStep: 'Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.',
      }),
    });

    const feature = factory.previewPlan({
      templateId: 'feature',
      prompt: 'Ship signed release notes',
      answers: { acceptance: 'Release notes visible', surface: 'desktop release flow' },
    });
    expect(feature.qualityGateReadiness).toEqual([
      {
        gate: 'release_readiness',
        status: 'setup_required',
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        reasons: ['Release secret env is missing: APPLE_ID.'],
        nextStep: 'Set missing release secrets, build sidecar artifacts, and refresh Release readiness before tagging.',
      },
    ]);

    const ui = factory.previewPlan({
      templateId: 'ui_scaffold',
      prompt: 'Build settings panel empty state',
      answers: { users: 'Operators', states: 'loading, empty, success, error' },
    });
    expect(ui.qualityGateReadiness.map((gate) => gate.gate)).toEqual(['browser_smoke']);
  });

  it('keeps intent id stable for normalized input and preserves explicit domain overrides', () => {
    const factory = createDefaultProductFactory();

    const a = factory.previewPlan({
      templateId: 'feature',
      prompt: '  Add operator delivery package  ',
      answers: { acceptance: 'Visible summary', surface: 'operator console' },
      domainIds: ['ops'],
    });

    const b = factory.previewPlan({
      templateId: 'feature',
      prompt: 'Add operator delivery package',
      answers: { acceptance: 'Visible summary', surface: 'operator console' },
      domainIds: ['ops'],
    });

    expect(a.intent.id).toBe(b.intent.id);
    expect(a.intent.domainIds).toEqual(['ops']);
    expect(a.scopedPlan.assumptions).toEqual([
      'Proceed under Pyrfor host authority with approvals, provenance and verifier gates enabled.',
    ]);
  });

  it('builds deterministic actor mailbox seeds for coding product templates only', () => {
    const factory = createDefaultProductFactory();
    const featurePreview = factory.previewPlan({
      templateId: 'feature',
      prompt: 'Add operator delivery package',
      answers: { acceptance: 'Visible summary', surface: 'operator console' },
    });
    const refactorPreview = factory.previewPlan({
      templateId: 'refactor',
      prompt: 'Refactor runtime delivery boundary',
      answers: { target: 'runtime delivery', invariants: 'public API shape stays stable' },
    });
    const bugfixPreview = factory.previewPlan({
      templateId: 'bugfix',
      prompt: 'Fix verifier gate regression',
      answers: { symptom: 'apply unlocks too early', expected: 'apply waits for verifier' },
    });
    const ochagPreview = factory.previewPlan({
      templateId: 'ochag_family_reminder',
      prompt: 'Send dinner reminder',
      answers: {
        familyId: 'fam-1',
        audience: 'parents',
        dueAt: '18:00 daily',
        visibility: 'family',
      },
    });

    const seeds = buildProductFactoryActorSeeds(featurePreview);

    expect(seeds.map((seed) => seed.actorId)).toEqual(['product-planner', 'product-implementer', 'product-reviewer']);
    expect(seeds.map((seed) => seed.role)).toEqual(['planner', 'implementer', 'reviewer']);
    expect(seeds.flatMap((seed) => seed.messages.map((message) => message.priority))).toEqual([300, 200, 100]);
    expect(seeds.flatMap((seed) => seed.messages.map((message) => message.idempotencyKey))).toEqual([
      `${featurePreview.intent.id}:actor:product-planner:brief`,
      `${featurePreview.intent.id}:actor:product-implementer:approach`,
      `${featurePreview.intent.id}:actor:product-reviewer:review`,
    ]);
    expect(seeds[0].messages[0].payload).toMatchObject({
      schemaVersion: 'pyrfor.product_factory_actor_seed.v1',
      templateId: 'feature',
      intentId: featurePreview.intent.id,
      actorRole: 'planner',
    });
    expect(buildProductFactoryActorSeeds(refactorPreview)).toHaveLength(3);
    expect(buildProductFactoryActorSeeds(bugfixPreview)).toHaveLength(3);
    expect(buildProductFactoryActorSeeds(ochagPreview)).toEqual([]);
  });

  it('maps Ochag family reminders to Ochag domain workflow nodes', () => {
    const factory = createDefaultProductFactory();
    const preview = factory.previewPlan({
      templateId: 'ochag_family_reminder',
      prompt: 'Send dinner reminder',
      answers: {
        familyId: 'fam-1',
        audience: 'parents',
        dueAt: '18:00 daily',
        visibility: 'family',
      },
    });

    expect(preview.intent.domainIds).toEqual(['ochag']);
    expect(preview.missingClarifications).toEqual([]);
    expect(preview.scopedPlan.qualityGates).toEqual(expect.arrayContaining([
      'telegram_smoke',
      'privacy_policy_check',
      'owner_escalation_check',
    ]));
    expect(preview.dagPreview.nodes.map((node) => node.kind)).toEqual([
      'ochag.classify_request',
      'ochag.privacy_check',
      'ochag.schedule_reminder',
      'ochag.telegram_notify',
    ]);
    expect(preview.dagPreview.nodes.every((node) => (node.payload as { domainIds?: string[] }).domainIds?.includes('ochag'))).toBe(true);
  });

  it('maps business briefs to CEOClaw evidence approval workflow nodes', () => {
    const factory = createDefaultProductFactory();
    const preview = factory.previewPlan({
      templateId: 'business_brief',
      prompt: 'Approve supplier contract',
      answers: {
        decision: 'Approve supplier contract',
        evidence: 'contract.pdf,finance-note.md',
      },
    });

    expect(preview.intent.domainIds).toEqual(['ceoclaw']);
    expect(preview.missingClarifications).toEqual([]);
    expect(preview.scopedPlan.qualityGates).toEqual(expect.arrayContaining([
      'evidence_check',
      'finance_impact_check',
      'approval_visibility',
    ]));
    expect(preview.dagPreview.nodes.map((node) => node.kind)).toEqual([
      'ceoclaw.collect_evidence',
      'ceoclaw.verify_evidence',
      'ceoclaw.finance_impact_check',
      'ceoclaw.request_approval',
      'ceoclaw.generate_report',
    ]);
    expect(preview.dagPreview.nodes.every((node) => (node.payload as { domainIds?: string[] }).domainIds?.includes('ceoclaw'))).toBe(true);
  });
});
