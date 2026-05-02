// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createDefaultProductFactory } from './product-factory';

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
    const factory = createDefaultProductFactory();
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
