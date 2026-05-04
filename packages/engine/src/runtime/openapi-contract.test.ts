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
      '/api/exec',
      '/api/pty/spawn',
      '/api/pty/list',
      '/api/git/status',
      '/api/settings/active-model',
      '/api/approvals/pending',
      '/api/effects/pending',
      '/api/approvals/{id}/decision',
      '/api/audit/events',
      '/api/events/stream',
      '/api/memory',
      '/api/memory/search',
      '/api/memory/corrections',
      '/api/memory/openclaw-import-report',
      '/api/memory/continuity',
      '/api/memory/openclaw-import',
      '/api/memory/rollup',
      '/api/memory/project-rollup',
      '/api/connectors/inventory',
      '/api/connectors/{connectorId}/probe',
      '/api/skills',
      '/api/slash-commands',
      '/api/slash-commands/invoke',
      '/api/skills/recommend',
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
      '/api/runs/{runId}/context-pack',
      '/api/runs/{runId}/delivery-evidence',
      '/api/runs/{runId}/research-evidence',
      '/api/runs/{runId}/research-search',
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
      'listRunEvents',
      'listRunDag',
      'listRunFrames',
      'listRunActors',
      'recoverStuckRunActorMessages',
      'enqueueRunActorMessage',
      'leaseRunActorMessage',
      'dispatchNextRunActorMessage',
      'completeRunActorMessage',
      'failRunActorMessage',
      'getRunContextPack',
      'getRunDeliveryEvidence',
      'captureRunDeliveryEvidence',
      'createRunResearchEvidence',
      'listRunResearchEvidence',
      'requestRunResearchSearch',
      'getRunGithubDeliveryPlan',
      'createRunGithubDeliveryPlan',
      'getRunGithubDeliveryApply',
      'requestRunGithubDeliveryApply',
      'getRunVerifierStatus',
      'createRunVerifierWaiver',
      'listPendingEffects',
      'streamOperatorEvents',
      'getMemorySnapshot',
      'searchMemory',
      'createMemoryCorrection',
      'createOpenClawImportReport',
      'getOpenClawImportReport',
      'getMemoryContinuityStatus',
      'importOpenClawMemory',
      'createMemoryRollup',
      'createProjectMemoryRollup',
      'getConnectorInventory',
      'probeConnector',
      'listSkills',
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
    expect(openapi).toContain('pyrfor.github_delivery_plan.v1');
    expect(openapi).toContain('pyrfor.github_delivery_apply.v1');
    expect(openapi).toContain('pyrfor.verifier_waiver.v1');
    expect(openapi).toContain('context_pack.v1');
    expect(openapi).toContain('ConnectorReadiness');
    expect(openapi).toContain('ConnectorProbePreview');
    expect(openapi).toContain('MemoryContinuityStatus');
    expect(openapi).toContain('Forbidden client-controlled scope override');
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
    expect(openapi).toContain('PublicDomainOverlay');
    expect(openapi).toContain('workflowCount');
  });
});
