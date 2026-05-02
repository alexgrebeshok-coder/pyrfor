import {
  DomainOverlayRegistry,
  type DomainOverlayManifest,
} from './domain-overlay';

export function createOchagOverlayManifest(): DomainOverlayManifest {
  return {
    schemaVersion: 'domain_overlay.v1',
    domainId: 'ochag',
    version: '0.1.0',
    title: 'Ochag family operations',
    taskSchemas: [
      {
        id: 'ochag.family_task',
        version: '0.1.0',
        schema: {
          type: 'object',
          required: ['title', 'familyId', 'visibility'],
          properties: {
            title: { type: 'string' },
            familyId: { type: 'string' },
            memberIds: { type: 'array', items: { type: 'string' } },
            visibility: { type: 'string', enum: ['member', 'family'] },
            dueAt: { type: 'string', format: 'date-time' },
            escalationPolicy: { type: 'string', enum: ['none', 'adult', 'owner'] },
          },
        },
      },
    ],
    eventSchemas: [
      {
        id: 'ochag.reminder_scheduled',
        version: '0.1.0',
        schema: {
          type: 'object',
          required: ['taskId', 'familyId', 'dueAt'],
          properties: {
            taskId: { type: 'string' },
            familyId: { type: 'string' },
            dueAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    ],
    workflowTemplates: [
      {
        id: 'family-reminder',
        title: 'Plan and send a family reminder',
        taskSchemaId: 'ochag.family_task',
        nodes: [
          {
            id: 'classify',
            kind: 'ochag.classify_request',
            retryClass: 'deterministic',
            payload: { goal: 'Classify household request, sensitivity and intended recipients.' },
          },
          {
            id: 'privacy-check',
            kind: 'ochag.privacy_check',
            dependsOn: ['classify'],
            retryClass: 'policy',
            timeoutClass: 'manual',
            payload: { goal: 'Ensure member-private context is not exposed to family/global scopes.' },
          },
          {
            id: 'schedule',
            kind: 'ochag.schedule_reminder',
            dependsOn: ['privacy-check'],
            payload: { goal: 'Create reminder/routine/calendar task with escalation metadata.' },
          },
          {
            id: 'notify',
            kind: 'ochag.telegram_notify',
            dependsOn: ['schedule'],
            payload: { goal: 'Notify allowed family members through Telegram.' },
          },
        ],
      },
      {
        id: 'daily-family-summary',
        title: 'Create daily family summary',
        taskSchemaId: 'ochag.family_task',
        nodes: [
          { id: 'collect', kind: 'ochag.collect_day_events' },
          { id: 'redact', kind: 'ochag.redact_private_items', dependsOn: ['collect'], retryClass: 'policy' },
          { id: 'summarize', kind: 'ochag.summarize_day', dependsOn: ['redact'] },
          { id: 'send', kind: 'ochag.telegram_notify', dependsOn: ['summarize'] },
        ],
      },
    ],
    adapterRegistrations: [
      { kind: 'connector', id: 'telegram-family-inbox', target: 'telegram' },
      { kind: 'tool', id: 'family-task-store', target: 'memory_write' },
    ],
    privacyRules: [
      {
        id: 'member-private-memory',
        appliesTo: 'context',
        effect: 'redact',
        note: 'Member-private memory can only enter member-scoped context packs.',
      },
      {
        id: 'sensitive-family-action',
        appliesTo: 'effect',
        toolName: 'telegram_send',
        effect: 'ask',
        note: 'Ask an owner/adult before sending sensitive escalations.',
      },
    ],
    toolPermissionOverrides: {
      telegram_send: 'ask_once',
      memory_write: 'ask_once',
      secrets_access: 'deny',
    },
    staticPolicyFacts: [
      {
        id: 'ochag:policy:privacy-boundary',
        content: 'Family/global context must not include member-private memory unless the target scope is the same member.',
      },
    ],
    staticDomainFacts: [
      {
        id: 'ochag:domain:roles',
        content: { roles: ['owner', 'adult', 'teen', 'child'], defaultEscalation: 'adult' },
      },
    ],
  };
}

export function createCeoclawOverlayManifest(): DomainOverlayManifest {
  return {
    schemaVersion: 'domain_overlay.v1',
    domainId: 'ceoclaw',
    version: '0.1.0',
    title: 'CEOClaw project operations',
    taskSchemas: [
      {
        id: 'ceoclaw.project_action',
        version: '0.1.0',
        schema: {
          type: 'object',
          required: ['projectId', 'actionType', 'title'],
          properties: {
            projectId: { type: 'string' },
            actionType: { type: 'string', enum: ['evidence', 'approval', 'finance', 'field_ops', 'report'] },
            title: { type: 'string' },
            budgetImpact: { type: 'number' },
            evidenceRefs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    ],
    eventSchemas: [
      {
        id: 'ceoclaw.evidence_registered',
        version: '0.1.0',
        schema: {
          type: 'object',
          required: ['projectId', 'evidenceRef', 'actor'],
          properties: {
            projectId: { type: 'string' },
            evidenceRef: { type: 'string' },
            actor: { type: 'string' },
          },
        },
      },
    ],
    workflowTemplates: [
      {
        id: 'evidence-approval',
        title: 'Register evidence and request approval',
        taskSchemaId: 'ceoclaw.project_action',
        nodes: [
          { id: 'collect-evidence', kind: 'ceoclaw.collect_evidence' },
          { id: 'verify-evidence', kind: 'ceoclaw.verify_evidence', dependsOn: ['collect-evidence'] },
          { id: 'impact-check', kind: 'ceoclaw.finance_impact_check', dependsOn: ['verify-evidence'] },
          {
            id: 'approval',
            kind: 'ceoclaw.request_approval',
            dependsOn: ['impact-check'],
            timeoutClass: 'manual',
            retryClass: 'human_needed',
          },
          { id: 'report', kind: 'ceoclaw.generate_report', dependsOn: ['approval'] },
        ],
      },
      {
        id: 'one-c-readonly-sync',
        title: 'Read-only 1C/ERP project sync',
        taskSchemaId: 'ceoclaw.project_action',
        nodes: [
          { id: 'prepare-query', kind: 'ceoclaw.prepare_erp_query' },
          { id: 'read-erp', kind: 'ceoclaw.one_c_readonly', dependsOn: ['prepare-query'], retryClass: 'transient' },
          { id: 'reconcile', kind: 'ceoclaw.reconcile_finance', dependsOn: ['read-erp'] },
        ],
      },
    ],
    adapterRegistrations: [
      { kind: 'connector', id: 'one-c-readonly', target: 'one-c' },
      { kind: 'connector', id: 'telegram-field-ops', target: 'telegram' },
      { kind: 'mcp', id: 'ceoclaw-mcp', target: 'ceoclaw' },
    ],
    privacyRules: [
      {
        id: 'finance-write-approval',
        appliesTo: 'effect',
        toolName: 'network_write',
        effect: 'deny',
        note: 'MVP allows read-only ERP sync; finance writes require a future signed adapter.',
      },
      {
        id: 'evidence-audit',
        appliesTo: 'audit',
        effect: 'allow',
        note: 'Evidence, approvals and finance-impact decisions must remain audit-visible.',
      },
    ],
    toolPermissionOverrides: {
      network_write: 'deny',
      secrets_access: 'ask_every_time',
      deploy: 'deny',
    },
    staticPolicyFacts: [
      {
        id: 'ceoclaw:policy:evidence-before-approval',
        content: 'Project approvals require evidence references and finance impact notes before approval requests are sent.',
      },
      {
        id: 'ceoclaw:policy:erp-readonly',
        content: '1C/ERP integration is read-only in MVP; write operations are denied.',
      },
    ],
    staticDomainFacts: [
      {
        id: 'ceoclaw:domain:golden-workflow',
        content: ['project', 'evidence', 'finance_impact', 'approval', 'report'],
      },
    ],
  };
}

export function registerDefaultDomainOverlays(registry = new DomainOverlayRegistry()): DomainOverlayRegistry {
  registry.register({ manifest: createOchagOverlayManifest() });
  registry.register({ manifest: createCeoclawOverlayManifest() });
  return registry;
}
