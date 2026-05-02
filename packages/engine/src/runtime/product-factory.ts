import { createHash } from 'node:crypto';
import type { AddDagNodeInput } from './durable-dag';

export type ProductFactoryTemplateId =
  | 'feature'
  | 'refactor'
  | 'bugfix'
  | 'bot_workflow'
  | 'ochag_family_reminder'
  | 'business_brief'
  | 'ui_scaffold';

export const PRODUCT_FACTORY_TEMPLATE_IDS: readonly ProductFactoryTemplateId[] = [
  'feature',
  'refactor',
  'bugfix',
  'bot_workflow',
  'ochag_family_reminder',
  'business_brief',
  'ui_scaffold',
];

export function isProductFactoryTemplateId(value: string): value is ProductFactoryTemplateId {
  return (PRODUCT_FACTORY_TEMPLATE_IDS as readonly string[]).includes(value);
}

export interface ProductFactoryClarification {
  id: string;
  question: string;
  required: boolean;
}

export interface ProductFactoryTemplate {
  id: ProductFactoryTemplateId;
  title: string;
  description: string;
  recommendedDomainIds: string[];
  clarifications: ProductFactoryClarification[];
  deliveryArtifacts: string[];
  qualityGates: string[];
}

export interface ProductFactoryPlanInput {
  templateId: ProductFactoryTemplateId;
  prompt: string;
  answers?: Record<string, string>;
  domainIds?: string[];
}

export interface ProductFactoryIntent {
  id: string;
  templateId: ProductFactoryTemplateId;
  title: string;
  goal: string;
  domainIds: string[];
}

export interface ProductFactoryScopedPlan {
  objective: string;
  scope: string[];
  assumptions: string[];
  risks: string[];
  qualityGates: string[];
}

export interface ProductFactoryDagPreview {
  nodes: AddDagNodeInput[];
}

export interface ProductFactoryPlanPreview {
  intent: ProductFactoryIntent;
  template: ProductFactoryTemplate;
  missingClarifications: ProductFactoryClarification[];
  scopedPlan: ProductFactoryScopedPlan;
  dagPreview: ProductFactoryDagPreview;
  deliveryChecklist: string[];
}

function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function cleanPrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

function titleFromPrompt(prompt: string): string {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return 'Untitled product task';
  const firstSentence = cleaned.split(/[.!?]/)[0] ?? cleaned;
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence;
}

const CANONICAL_TEMPLATES: ProductFactoryTemplate[] = [
  {
    id: 'feature',
    title: 'Feature delivery',
    description: 'Turn a feature idea into a scoped implementation plan, coding DAG and delivery checklist.',
    recommendedDomainIds: [],
    clarifications: [
      { id: 'acceptance', question: 'What user-visible acceptance criteria define success?', required: true },
      { id: 'surface', question: 'Which app/API/UI surfaces are in scope?', required: true },
      { id: 'out_of_scope', question: 'What should explicitly stay out of scope?', required: false },
    ],
    deliveryArtifacts: ['implementation_summary', 'changed_files', 'tests_run', 'release_notes', 'deployment_checklist'],
    qualityGates: ['typecheck', 'focused_tests', 'build'],
  },
  {
    id: 'refactor',
    title: 'Safe refactor',
    description: 'Plan a behavior-preserving refactor with provenance and regression checks.',
    recommendedDomainIds: [],
    clarifications: [
      { id: 'target', question: 'Which module or boundary should be refactored?', required: true },
      { id: 'invariants', question: 'Which behavior must not change?', required: true },
      { id: 'migration', question: 'Is a compatibility/migration path required?', required: false },
    ],
    deliveryArtifacts: ['refactor_summary', 'changed_files', 'regression_tests', 'rollback_notes'],
    qualityGates: ['typecheck', 'regression_tests', 'build'],
  },
  {
    id: 'bugfix',
    title: 'Bug fix',
    description: 'Reproduce, fix and verify a defect with evidence.',
    recommendedDomainIds: [],
    clarifications: [
      { id: 'symptom', question: 'What exact symptom or failing command demonstrates the bug?', required: true },
      { id: 'expected', question: 'What should happen instead?', required: true },
      { id: 'scope', question: 'Which environments or users are affected?', required: false },
    ],
    deliveryArtifacts: ['root_cause', 'fix_summary', 'test_evidence', 'changed_files'],
    qualityGates: ['reproduction_check', 'focused_tests', 'build'],
  },
  {
    id: 'bot_workflow',
    title: 'Telegram/bot workflow',
    description: 'Design and implement a governed bot workflow with permissions and delivery checks.',
    recommendedDomainIds: ['ochag'],
    clarifications: [
      { id: 'audience', question: 'Who can trigger this workflow and who receives messages?', required: true },
      { id: 'trigger', question: 'What command, schedule or event starts the workflow?', required: true },
      { id: 'privacy', question: 'What private/sensitive data must be redacted or approved?', required: true },
    ],
    deliveryArtifacts: ['workflow_spec', 'bot_commands', 'privacy_checks', 'operator_runbook'],
    qualityGates: ['telegram_smoke', 'privacy_policy_check', 'focused_tests'],
  },
  {
    id: 'ochag_family_reminder',
    title: 'Ochag family reminder',
    description: 'Plan a family-scoped Telegram reminder with visibility, escalation and privacy checks.',
    recommendedDomainIds: ['ochag'],
    clarifications: [
      { id: 'familyId', question: 'Which family/workspace should own this reminder?', required: true },
      { id: 'audience', question: 'Who should receive the reminder?', required: true },
      { id: 'dueAt', question: 'When should the reminder fire?', required: true },
      { id: 'visibility', question: 'Is this member-private or family-visible?', required: true },
      { id: 'privacy', question: 'What sensitive details must be redacted or approved?', required: false },
    ],
    deliveryArtifacts: ['workflow_spec', 'privacy_checks', 'telegram_message_preview', 'family_runbook'],
    qualityGates: ['telegram_smoke', 'privacy_policy_check', 'owner_escalation_check'],
  },
  {
    id: 'business_brief',
    title: 'Business/CEO brief',
    description: 'Create an evidence-backed business brief with approvals and next actions.',
    recommendedDomainIds: ['ceoclaw'],
    clarifications: [
      { id: 'decision', question: 'What decision or approval should the brief support?', required: true },
      { id: 'evidence', question: 'Which evidence sources should be considered?', required: true },
      { id: 'projectId', question: 'Which project or business initiative is this brief for?', required: false },
      { id: 'deadline', question: 'When is the decision needed?', required: false },
    ],
    deliveryArtifacts: ['executive_summary', 'evidence_table', 'risks', 'approval_request'],
    qualityGates: ['evidence_check', 'finance_impact_check', 'approval_visibility'],
  },
  {
    id: 'ui_scaffold',
    title: 'UI scaffold',
    description: 'Plan a UI scaffold with component, state, test and visual QA steps.',
    recommendedDomainIds: [],
    clarifications: [
      { id: 'users', question: 'Who is the target user and primary job-to-be-done?', required: true },
      { id: 'states', question: 'Which loading, empty, success and error states are required?', required: true },
      { id: 'style', question: 'Which visual style or existing component conventions should be reused?', required: false },
    ],
    deliveryArtifacts: ['component_summary', 'state_matrix', 'visual_qa_notes', 'changed_files'],
    qualityGates: ['component_tests', 'build', 'browser_smoke'],
  },
];

export class ProductFactory {
  private readonly templates = new Map<ProductFactoryTemplateId, ProductFactoryTemplate>(
    CANONICAL_TEMPLATES.map((template) => [template.id, template]),
  );

  listTemplates(): ProductFactoryTemplate[] {
    return [...this.templates.values()].map((template) => ({
      ...template,
      recommendedDomainIds: [...template.recommendedDomainIds],
      clarifications: template.clarifications.map((item) => ({ ...item })),
      deliveryArtifacts: [...template.deliveryArtifacts],
      qualityGates: [...template.qualityGates],
    }));
  }

  getTemplate(templateId: ProductFactoryTemplateId): ProductFactoryTemplate {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Unknown product factory template "${templateId}"`);
    return this.listTemplates().find((candidate) => candidate.id === templateId)!;
  }

  previewPlan(input: ProductFactoryPlanInput): ProductFactoryPlanPreview {
    const template = this.getTemplate(input.templateId);
    const intent = this.draftIntent(template, input);
    const missingClarifications = this.collectClarifications(template, input.answers ?? {});
    const scopedPlan = this.buildScopedPlan(template, intent, input.answers ?? {}, missingClarifications);
    return {
      intent,
      template,
      missingClarifications,
      scopedPlan,
      dagPreview: this.buildDagPreview(template, intent),
      deliveryChecklist: this.buildDeliveryArtifactChecklist(template),
    };
  }

  private draftIntent(template: ProductFactoryTemplate, input: ProductFactoryPlanInput): ProductFactoryIntent {
    const goal = cleanPrompt(input.prompt);
    if (!goal) throw new Error('ProductFactory: prompt is required');
    const domainIds = input.domainIds?.length ? input.domainIds : template.recommendedDomainIds;
    return {
      id: `pf-${hashId(`${template.id}:${goal}:${JSON.stringify(input.answers ?? {})}`)}`,
      templateId: template.id,
      title: titleFromPrompt(goal),
      goal,
      domainIds: [...domainIds],
    };
  }

  private collectClarifications(
    template: ProductFactoryTemplate,
    answers: Record<string, string>,
  ): ProductFactoryClarification[] {
    return template.clarifications
      .filter((item) => item.required && !answers[item.id]?.trim())
      .map((item) => ({ ...item }));
  }

  private buildScopedPlan(
    template: ProductFactoryTemplate,
    intent: ProductFactoryIntent,
    answers: Record<string, string>,
    missing: ProductFactoryClarification[],
  ): ProductFactoryScopedPlan {
    const answeredScope = template.clarifications
      .filter((item) => answers[item.id]?.trim())
      .map((item) => `${item.question} ${answers[item.id]!.trim()}`);
    return {
      objective: intent.goal,
      scope: answeredScope.length > 0
        ? answeredScope
        : [`Use the ${template.title} template to convert the idea into an executable Pyrfor run.`],
      assumptions: missing.length > 0
        ? ['Do not execute external workers until required clarifications are answered.']
        : ['Proceed under Pyrfor host authority with approvals, provenance and verifier gates enabled.'],
      risks: missing.map((item) => `Missing clarification: ${item.question}`),
      qualityGates: [...template.qualityGates],
    };
  }

  private buildDagPreview(template: ProductFactoryTemplate, intent: ProductFactoryIntent): ProductFactoryDagPreview {
    if (template.id === 'ochag_family_reminder') {
      return this.buildOchagFamilyReminderDagPreview(template, intent);
    }
    if (template.id === 'business_brief') {
      return this.buildCeoclawBusinessBriefDagPreview(template, intent);
    }

    const prefix = `product_factory/${intent.id}`;
    const basePayload = {
      productFactory: true,
      templateId: template.id,
      intentId: intent.id,
      domainIds: intent.domainIds,
    };
    return {
      nodes: [
        {
          id: `${prefix}/clarify`,
          kind: 'product_factory.clarify_scope',
          payload: { ...basePayload, goal: 'Collect required clarifications and confirm boundaries.' },
          retryClass: 'human_needed',
          timeoutClass: 'manual',
        },
        {
          id: `${prefix}/context`,
          kind: 'product_factory.compile_context',
          dependsOn: [`${prefix}/clarify`],
          payload: { ...basePayload, goal: 'Compile deterministic context pack and domain policy facts.' },
          retryClass: 'deterministic',
        },
        {
          id: `${prefix}/plan`,
          kind: 'product_factory.scoped_plan',
          dependsOn: [`${prefix}/context`],
          payload: { ...basePayload, goal: 'Materialize scoped implementation plan and work breakdown.' },
          retryClass: 'deterministic',
        },
        {
          id: `${prefix}/worker`,
          kind: 'product_factory.worker_execution',
          dependsOn: [`${prefix}/plan`],
          payload: { ...basePayload, goal: 'Route worker frames through Pyrfor host authority.' },
        },
        {
          id: `${prefix}/verify`,
          kind: 'product_factory.verify',
          dependsOn: [`${prefix}/worker`],
          payload: { ...basePayload, goal: 'Run verifier lane and quality gates before delivery.' },
          retryClass: 'policy',
        },
        {
          id: `${prefix}/deliver`,
          kind: 'product_factory.delivery_package',
          dependsOn: [`${prefix}/verify`],
          payload: { ...basePayload, goal: 'Package summary, changed files, tests, release notes and deployment checklist.' },
        },
      ],
    };
  }

  private buildOchagFamilyReminderDagPreview(
    template: ProductFactoryTemplate,
    intent: ProductFactoryIntent,
  ): ProductFactoryDagPreview {
    const prefix = `product_factory/${intent.id}/ochag/family-reminder`;
    const basePayload = {
      productFactory: true,
      templateId: template.id,
      intentId: intent.id,
      domainIds: intent.domainIds,
      domainId: 'ochag',
      workflowTemplateId: 'family-reminder',
      taskSchemaId: 'ochag.family_task',
    };
    return {
      nodes: [
        {
          id: `${prefix}/classify`,
          kind: 'ochag.classify_request',
          payload: { ...basePayload, goal: 'Classify household request, sensitivity and intended recipients.' },
          retryClass: 'deterministic',
        },
        {
          id: `${prefix}/privacy-check`,
          kind: 'ochag.privacy_check',
          dependsOn: [`${prefix}/classify`],
          payload: { ...basePayload, goal: 'Verify member/family visibility and escalation approvals.' },
          retryClass: 'policy',
          timeoutClass: 'manual',
        },
        {
          id: `${prefix}/schedule`,
          kind: 'ochag.schedule_reminder',
          dependsOn: [`${prefix}/privacy-check`],
          payload: { ...basePayload, goal: 'Create reminder/routine/calendar task with escalation metadata.' },
        },
        {
          id: `${prefix}/notify`,
          kind: 'ochag.telegram_notify',
          dependsOn: [`${prefix}/schedule`],
          payload: { ...basePayload, goal: 'Notify allowed family members through Telegram.' },
        },
      ],
    };
  }

  private buildCeoclawBusinessBriefDagPreview(
    template: ProductFactoryTemplate,
    intent: ProductFactoryIntent,
  ): ProductFactoryDagPreview {
    const prefix = `product_factory/${intent.id}/ceoclaw/evidence-approval`;
    const basePayload = {
      productFactory: true,
      templateId: template.id,
      intentId: intent.id,
      domainIds: intent.domainIds,
      domainId: 'ceoclaw',
      workflowTemplateId: 'evidence-approval',
      taskSchemaId: 'ceoclaw.project_action',
    };
    return {
      nodes: [
        {
          id: `${prefix}/collect-evidence`,
          kind: 'ceoclaw.collect_evidence',
          payload: { ...basePayload, goal: 'Collect evidence sources and decision context for the CEO brief.' },
        },
        {
          id: `${prefix}/verify-evidence`,
          kind: 'ceoclaw.verify_evidence',
          dependsOn: [`${prefix}/collect-evidence`],
          payload: { ...basePayload, goal: 'Verify evidence completeness and traceability.' },
          retryClass: 'policy',
        },
        {
          id: `${prefix}/impact-check`,
          kind: 'ceoclaw.finance_impact_check',
          dependsOn: [`${prefix}/verify-evidence`],
          payload: { ...basePayload, goal: 'Assess finance/business impact before approval.' },
          retryClass: 'policy',
        },
        {
          id: `${prefix}/approval`,
          kind: 'ceoclaw.request_approval',
          dependsOn: [`${prefix}/impact-check`],
          payload: { ...basePayload, goal: 'Request CEO/operator approval with evidence and impact notes.' },
          retryClass: 'human_needed',
          timeoutClass: 'manual',
        },
        {
          id: `${prefix}/report`,
          kind: 'ceoclaw.generate_report',
          dependsOn: [`${prefix}/approval`],
          payload: { ...basePayload, goal: 'Generate executive summary, evidence table, risks and next actions.' },
        },
      ],
    };
  }

  private buildDeliveryArtifactChecklist(template: ProductFactoryTemplate): string[] {
    return [...template.deliveryArtifacts];
  }
}

export function createDefaultProductFactory(): ProductFactory {
  return new ProductFactory();
}
