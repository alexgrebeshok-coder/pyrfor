// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_FACTORY_TEMPLATE_IDS } from './product-factory';

const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(join(here, 'openapi.yaml'), 'utf-8');

describe('runtime OpenAPI contract coverage', () => {
  it('documents the Engine/App gateway seam routes', () => {
    const documentedPaths = [
      '/api/runtime/credentials',
      '/api/workspace',
      '/api/workspace/open',
      '/api/fs/list',
      '/api/fs/read',
      '/api/fs/write',
      '/api/fs/search',
      '/api/chat',
      '/api/chat/stream',
      '/agent/run',
      '/api/exec',
      '/api/pty/spawn',
      '/api/pty/list',
      '/api/git/status',
      '/api/settings/active-model',
      '/api/settings/provider-routing-preview',
      '/api/settings/execution-mode',
      '/api/approvals/pending',
      '/api/effects/pending',
      '/api/approvals/{id}/decision',
      '/api/audit/events',
      '/api/events/stream',
      '/api/memory',
      '/api/memory/search',
      '/api/memory/pending-reviews',
      '/api/memory/corrections',
      '/api/memory/{memoryId}/review',
      '/api/memory/openclaw-import-report',
      '/api/memory/continuity',
      '/api/memory/openclaw-import',
      '/api/memory/rollup',
      '/api/memory/project-rollup',
      '/api/connectors/inventory',
      '/api/connectors/{connectorId}/probe',
      '/api/research/readiness',
      '/api/github/delivery-readiness',
      '/api/browser/readiness',
      '/api/release/readiness',
      '/api/skills',
      '/api/skills/import',
      '/api/skills/{skillId}/test',
      '/api/skills/{skillId}/approve',
      '/api/slash-commands',
      '/api/slash-commands/invoke',
      '/api/skills/recommend',
      '/api/tools/registry',
      '/api/agents',
      '/api/sessions',
      '/api/sessions/{sessionId}',
      '/api/sessions/{sessionId}/timeline',
      '/api/product-factory/templates',
      '/api/product-factory/plan',
      '/api/ochag/privacy',
      '/api/ochag/reminders/preview',
      '/api/ochag/reminders',
      '/api/ceoclaw/briefs/preview',
      '/api/ceoclaw/briefs',
      '/api/runs',
      '/api/runs/{runId}',
      '/api/runs/{runId}/timeline',
      '/api/runs/{runId}/events',
      '/api/runs/{runId}/dag',
      '/api/runs/{runId}/frames',
      '/api/runs/{runId}/actors',
      '/api/runs/{runId}/actors/recover-stuck',
      '/api/runs/{runId}/actors/messages',
      '/api/runs/{runId}/actors/messages/lease',
      '/api/runs/{runId}/actors/messages/dispatch-next',
      '/api/runs/{runId}/actors/messages/{nodeId}/complete',
      '/api/runs/{runId}/actors/messages/{nodeId}/fail',
      '/api/runs/{runId}/product-factory-plan',
      '/api/runs/{runId}/context-pack',
      '/api/runs/{runId}/delivery-evidence',
      '/api/runs/{runId}/browser-smoke',
      '/api/runs/{runId}/research-evidence',
      '/api/runs/{runId}/research-search',
      '/api/runs/{runId}/research-source-captures',
      '/api/runs/{runId}/github-delivery-plan',
      '/api/runs/{runId}/github-delivery-apply',
      '/api/runs/{runId}/verifier-status',
      '/api/runs/{runId}/verifier-waiver',
      '/api/runs/{runId}/control',
      '/api/overlays',
      '/api/overlay-summaries',
      '/api/overlay-summaries/{domainId}',
      '/api/overlays/{domainId}',
    ];

    for (const path of documentedPaths) {
      expect(openapi).toContain(`  ${path}:`);
    }
  });

  it('pins orchestration/product operation ids and template enum contract', () => {
    const operationIds = [
      'listProductFactoryTemplates',
      'previewProductFactoryPlan',
      'createProductFactoryRun',
      'getOchagPrivacy',
      'previewOchagReminder',
      'createOchagReminderRun',
      'previewCeoclawBrief',
      'createCeoclawBriefRun',
      'listRuns',
      'getRun',
      'getRunTimeline',
      'listRunEvents',
      'reviewMemory',
      'listRunDag',
      'listRunFrames',
      'listRunActors',
      'recoverStuckRunActorMessages',
      'listRunActorMessages',
      'enqueueRunActorMessage',
      'leaseRunActorMessage',
      'dispatchNextRunActorMessage',
      'completeRunActorMessage',
      'failRunActorMessage',
      'getRunProductFactoryPlan',
      'getRunContextPack',
      'refreshRunContextPack',
      'getRunDeliveryEvidence',
      'captureRunDeliveryEvidence',
      'listRunBrowserSmoke',
      'requestRunBrowserSmoke',
      'createRunResearchEvidence',
      'listRunResearchEvidence',
      'requestRunResearchSearch',
      'listRunResearchSourceCaptures',
      'requestRunResearchSourceCapture',
      'getRunGithubDeliveryPlan',
      'createRunGithubDeliveryPlan',
      'getRunGithubDeliveryApply',
      'requestRunGithubDeliveryApply',
      'getRunVerifierStatus',
      'createRunVerifierWaiver',
      'getProviderRoutingPreview',
      'getExecutionMode',
      'setExecutionMode',
      'runAgentAgUi',
      'listPendingEffects',
      'streamOperatorEvents',
      'getMemorySnapshot',
      'searchMemory',
      'listPendingMemoryReviews',
      'createMemoryCorrection',
      'createOpenClawImportReport',
      'getOpenClawImportReport',
      'getMemoryContinuityStatus',
      'importOpenClawMemory',
      'createMemoryRollup',
      'createProjectMemoryRollup',
      'getConnectorInventory',
      'probeConnector',
      'getResearchReadiness',
      'getGithubDeliveryReadiness',
       'getBrowserReadiness',
       'listSkills',
       'testImportedSkill',
       'approveImportedSkill',
       'listSlashCommands',
      'invokeSlashCommand',
      'recommendSkills',
      'listAgents',
      'listSessions',
      'getSession',
      'getSessionTimeline',
      'controlRun',
      'listOverlays',
      'listPublicOverlays',
      'getPublicOverlay',
      'getOverlay',
    ];

    for (const operationId of operationIds) {
      expect(openapi).toContain(`operationId: ${operationId}`);
    }

    expect(openapi).toContain(`enum: [${PRODUCT_FACTORY_TEMPLATE_IDS.join(', ')}]`);
    expect(openapi).toContain('enum: [execute, replay, continue, abort]');
    expect(openapi).toContain('pyrfor.delivery_evidence.v1');
    expect(openapi).toContain('pyrfor.research_evidence.v2');
    expect(openapi).toContain('pyrfor.browser_smoke.v1');
    expect(openapi).toContain('pyrfor.github_delivery_plan.v1');
    expect(openapi).toContain('pyrfor.github_delivery_apply.v1');
    expect(openapi).toContain('pyrfor.verifier_waiver.v1');
    expect(openapi).toContain('context_pack.v1');
    expect(openapi).toContain('ConnectorReadiness');
    expect(openapi).toContain('ConnectorProbePreview');
    expect(openapi).toContain('MemoryContinuityStatus');
    const ideChatRoute = openapi.slice(
      openapi.indexOf('  /api/chat:'),
      openapi.indexOf('  /api/chat/stream:'),
    );
    expect(ideChatRoute).toContain('$ref: "#/components/schemas/IdeChatResponse"');
    expect(ideChatRoute).toContain('FreeClaude worker transport');
    const ideChatStreamRoute = openapi.slice(
      openapi.indexOf('  /api/chat/stream:'),
      openapi.indexOf('  /api/exec:'),
    );
    expect(ideChatStreamRoute).toContain('FreeClaude worker transport');
    const ideChatResponseBlock = openapi.slice(
      openapi.indexOf('    IdeChatResponse:'),
      openapi.indexOf('    ExecResult:'),
    );
    expect(ideChatResponseBlock).not.toContain('ExecutionModeFallback');
    expect(openapi).toContain('Forbidden client-controlled scope override');
    const projectRollupBlock = openapi.slice(
      openapi.indexOf('  /api/memory/project-rollup:'),
      openapi.indexOf('  /api/sessions:'),
    );
    expect(projectRollupBlock).toContain('Invalid JSON, missing project id, invalid session limit, forbidden client-controlled scope override, or rollup failure');
    expect(projectRollupBlock).toContain('Durable memory persistence failed');
    const researchSearchRequestBlock = openapi.slice(
      openapi.indexOf('    ResearchSearchRequest:'),
      openapi.indexOf('    ResearchSearchApprovalResponse:'),
    );
    expect(researchSearchRequestBlock).toContain('enum: [brave, duckduckgo]');
    expect(researchSearchRequestBlock).toContain('Optional governed search provider');
    expect(openapi).toContain('PublicSkillSummary');
    expect(openapi).toContain('PublicSlashCommand');
    expect(openapi).toContain('SlashCommandInvokeRequest');
    const slashInvokeRequestBlock = openapi.slice(
      openapi.indexOf('    SlashCommandInvokeRequest:'),
      openapi.indexOf('    SlashCommandInvokeResponse:'),
    );
    expect(slashInvokeRequestBlock).not.toContain('workspaceId');
    expect(slashInvokeRequestBlock).not.toContain('sessionId');
    expect(slashInvokeRequestBlock).not.toContain('runId');
    expect(openapi).toContain('RuntimeSubagentSummary');
    expect(openapi).toContain('ProviderRoutingPreview');
    expect(openapi).toContain('ProviderRoutingPreviewProvider');
    const executionModeRoute = openapi.slice(
      openapi.indexOf('  /api/settings/execution-mode:'),
      openapi.indexOf('  /api/approvals/pending:'),
    );
    expect(executionModeRoute).toContain('operationId: getExecutionMode');
    expect(executionModeRoute).toContain('security: []');
    expect(executionModeRoute).toContain('operationId: setExecutionMode');
    expect(executionModeRoute).toContain('$ref: "#/components/schemas/ExecutionModeSettings"');
    expect(executionModeRoute).toContain('$ref: "#/components/schemas/ExecutionModeUpdateResponse"');
    const executionModeSchema = openapi.slice(
      openapi.indexOf('    ExecutionMode:'),
      openapi.indexOf('    ProviderRoutingPreview:'),
    );
    expect(executionModeSchema).toContain('enum: [pyrfor, freeclaude]');
    expect(executionModeSchema).toContain('required: [executionMode]');
    expect(executionModeSchema).toContain('required: [ok]');
    expect(openapi).toContain('PublicDomainOverlay');
    expect(openapi).toContain('workflowCount');
    expect(openapi).toContain('OchagPrivacyPolicy');
    expect(openapi).toContain('OchagPrivacyRule');
    const ochagPrivacyBlock = openapi.slice(
      openapi.indexOf('  /api/ochag/privacy:'),
      openapi.indexOf('  /api/ochag/reminders/preview:'),
    );
    expect(ochagPrivacyBlock).toContain('$ref: "#/components/schemas/OchagPrivacyPolicy"');
    expect(ochagPrivacyBlock).toContain('$ref: "#/components/responses/Unauthorized"');
    expect(ochagPrivacyBlock).toContain('Ochag overlay not found');
    const ochagPrivacyRuleBlock = openapi.slice(
      openapi.indexOf('    OchagPrivacyRule:'),
      openapi.indexOf('    OchagAdapterRegistration:'),
    );
    expect(ochagPrivacyRuleBlock).toContain('required: [id, appliesTo, effect]');
    const ochagAdapterBlock = openapi.slice(
      openapi.indexOf('    OchagAdapterRegistration:'),
      openapi.indexOf('    OchagReminderInput:'),
    );
    expect(ochagAdapterBlock).toContain('required: [kind, id, target]');
  });

  it('pins scoped verifier-status contract', () => {
    const runRoute = openapi.slice(
      openapi.indexOf('  /api/runs/{runId}:'),
      openapi.indexOf('  /api/runs/{runId}/events:'),
    );
    const verifierStatusRoute = openapi.slice(
      openapi.indexOf('  /api/runs/{runId}/verifier-status:'),
      openapi.indexOf('  /api/runs/{runId}/verifier-waiver:'),
    );

    expect(runRoute).not.toContain('name: scope');
    expect(verifierStatusRoute).toContain('operationId: getRunVerifierStatus');
    expect(verifierStatusRoute).toContain('name: scope');
    expect(verifierStatusRoute).toContain('$ref: "#/components/schemas/VerifierWaiverScope"');
    expect(verifierStatusRoute).toContain('"400":');
    expect(openapi).toContain('VerifierWaiverScope:');
    expect(openapi).toContain('enum: [run, delivery, delivery_plan, delivery_apply, all]');
  });
});
