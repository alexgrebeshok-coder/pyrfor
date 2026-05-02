import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetDashboard = vi.fn();
const mockCaptureRunDeliveryEvidence = vi.fn();
const mockCreateRunGithubDeliveryPlan = vi.fn();
const mockListRuns = vi.fn();
const mockGetRun = vi.fn();
const mockGetRunDeliveryEvidence = vi.fn();
const mockGetRunGithubDeliveryPlan = vi.fn();
const mockListRunEvents = vi.fn();
const mockListRunDag = vi.fn();
const mockListRunFrames = vi.fn();
const mockControlRun = vi.fn();
const mockListOverlays = vi.fn();
const mockGetOverlay = vi.fn();
const mockListProductFactoryTemplates = vi.fn();
const mockPreviewProductFactoryPlan = vi.fn();
const mockCreateProductFactoryRun = vi.fn();
const mockPreviewOchagReminder = vi.fn();
const mockCreateOchagReminderRun = vi.fn();
const mockGetOchagPrivacy = vi.fn();
const mockPreviewCeoclawBrief = vi.fn();
const mockCreateCeoclawBriefRun = vi.fn();

vi.mock('../../lib/api', () => ({
  getDashboard: (...args: unknown[]) => mockGetDashboard(...args),
  captureRunDeliveryEvidence: (...args: unknown[]) => mockCaptureRunDeliveryEvidence(...args),
  createRunGithubDeliveryPlan: (...args: unknown[]) => mockCreateRunGithubDeliveryPlan(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  getRun: (...args: unknown[]) => mockGetRun(...args),
  getRunDeliveryEvidence: (...args: unknown[]) => mockGetRunDeliveryEvidence(...args),
  getRunGithubDeliveryPlan: (...args: unknown[]) => mockGetRunGithubDeliveryPlan(...args),
  listRunEvents: (...args: unknown[]) => mockListRunEvents(...args),
  listRunDag: (...args: unknown[]) => mockListRunDag(...args),
  listRunFrames: (...args: unknown[]) => mockListRunFrames(...args),
  controlRun: (...args: unknown[]) => mockControlRun(...args),
  listOverlays: (...args: unknown[]) => mockListOverlays(...args),
  getOverlay: (...args: unknown[]) => mockGetOverlay(...args),
  listProductFactoryTemplates: (...args: unknown[]) => mockListProductFactoryTemplates(...args),
  previewProductFactoryPlan: (...args: unknown[]) => mockPreviewProductFactoryPlan(...args),
  createProductFactoryRun: (...args: unknown[]) => mockCreateProductFactoryRun(...args),
  previewOchagReminder: (...args: unknown[]) => mockPreviewOchagReminder(...args),
  createOchagReminderRun: (...args: unknown[]) => mockCreateOchagReminderRun(...args),
  getOchagPrivacy: (...args: unknown[]) => mockGetOchagPrivacy(...args),
  previewCeoclawBrief: (...args: unknown[]) => mockPreviewCeoclawBrief(...args),
  createCeoclawBriefRun: (...args: unknown[]) => mockCreateCeoclawBriefRun(...args),
}));

import OrchestrationPanel from '../OrchestrationPanel';

describe('OrchestrationPanel', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
    mockCaptureRunDeliveryEvidence.mockReset();
    mockCreateRunGithubDeliveryPlan.mockReset();
    mockListRuns.mockReset();
    mockGetRun.mockReset();
    mockGetRunDeliveryEvidence.mockReset();
    mockGetRunGithubDeliveryPlan.mockReset();
    mockListRunEvents.mockReset();
    mockListRunDag.mockReset();
    mockListRunFrames.mockReset();
    mockControlRun.mockReset();
    mockListOverlays.mockReset();
    mockGetOverlay.mockReset();
    mockListProductFactoryTemplates.mockReset();
    mockPreviewProductFactoryPlan.mockReset();
    mockCreateProductFactoryRun.mockReset();
    mockPreviewOchagReminder.mockReset();
    mockCreateOchagReminderRun.mockReset();
    mockGetOchagPrivacy.mockReset();
    mockPreviewCeoclawBrief.mockReset();
    mockCreateCeoclawBriefRun.mockReset();

    mockGetDashboard.mockResolvedValue({
      orchestration: {
        runs: { total: 1, active: 1, blocked: 0, latest: [] },
        dag: { total: 2, ready: 1, running: 1, blocked: 0 },
        effects: { pending: 1 },
        approvals: { pending: 2 },
        verifier: { blocked: 0, status: 'warning' },
        workerFrames: { total: 3, pending: 0, lastType: 'final_report' },
        contextPack: null,
        overlays: { total: 2, domainIds: ['ceoclaw', 'ochag'] },
      },
    });
    mockListRuns.mockResolvedValue({
      runs: [
        {
          run_id: 'run-1',
          task_id: 'Build product',
          workspace_id: 'workspace-1',
          repo_id: 'repo-1',
          branch_or_worktree_id: 'main',
          mode: 'pm',
          status: 'running',
          artifact_refs: [],
          created_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-01T00:05:00.000Z',
        },
      ],
    });
    mockListOverlays.mockResolvedValue({
      overlays: [
        {
          schemaVersion: 'domain_overlay.v1',
          domainId: 'ceoclaw',
          version: '1.0.0',
          title: 'CEOClaw',
          workflowTemplates: [{ id: 'evidence-approval' }],
          adapterRegistrations: [{ id: 'ceoclaw-mcp' }],
          privacyRules: [{ id: 'finance-write-approval' }],
          toolPermissionOverrides: { network_write: 'deny', secrets_access: 'ask_every_time' },
        },
        { schemaVersion: 'domain_overlay.v1', domainId: 'ochag', version: '1.0.0', title: 'Ochag' },
      ],
    });
    mockListProductFactoryTemplates.mockResolvedValue({
      templates: [
        {
          id: 'feature',
          title: 'Feature delivery',
          description: 'Feature template',
          recommendedDomainIds: [],
          clarifications: [{ id: 'acceptance', question: 'Acceptance?', required: true }],
          deliveryArtifacts: ['implementation_summary'],
          qualityGates: ['build'],
        },
        {
          id: 'ochag_family_reminder',
          title: 'Ochag family reminder',
          description: 'Ochag template',
          recommendedDomainIds: ['ochag'],
          clarifications: [{ id: 'privacy', question: 'Privacy?', required: false }],
          deliveryArtifacts: ['telegram_message_preview'],
          qualityGates: ['telegram_smoke'],
        },
        {
          id: 'business_brief',
          title: 'Business/CEO brief',
          description: 'Business brief template',
          recommendedDomainIds: ['ceoclaw'],
          clarifications: [{ id: 'decision', question: 'Decision?', required: true }],
          deliveryArtifacts: ['executive_summary'],
          qualityGates: ['evidence_check'],
        },
      ],
    });
    mockPreviewProductFactoryPlan.mockResolvedValue({
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [{ id: 'acceptance', question: 'Acceptance?', required: true }],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
    });
    mockCreateProductFactoryRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'pf-1',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-1'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-1', templateId: 'feature', title: 'Build delivery package', goal: 'Build delivery package', domainIds: [] },
        template: { id: 'feature', title: 'Feature delivery' },
        missingClarifications: [],
        scopedPlan: { objective: 'Build delivery package', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
        dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
        deliveryChecklist: ['implementation_summary'],
      },
      artifact: { id: 'artifact-1' },
    });
    mockPreviewOchagReminder.mockResolvedValue({
      preview: {
        intent: { id: 'pf-ochag', templateId: 'ochag_family_reminder', title: 'Send dinner reminder', goal: 'Send dinner reminder', domainIds: ['ochag'] },
        template: { id: 'ochag_family_reminder', title: 'Ochag family reminder' },
        missingClarifications: [],
        scopedPlan: { objective: 'Send dinner reminder', scope: [], assumptions: [], risks: [], qualityGates: ['telegram_smoke'] },
        dagPreview: { nodes: [{ id: 'pf-ochag/notify', kind: 'ochag.telegram_notify' }] },
        deliveryChecklist: ['telegram_message_preview'],
      },
    });
    mockCreateOchagReminderRun.mockResolvedValue({
      run: {
        run_id: 'run-ochag',
        task_id: 'pf-ochag',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-ochag'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-ochag', templateId: 'ochag_family_reminder', title: 'Send dinner reminder', goal: 'Send dinner reminder', domainIds: ['ochag'] },
        template: { id: 'ochag_family_reminder', title: 'Ochag family reminder' },
        missingClarifications: [],
        scopedPlan: { objective: 'Send dinner reminder', scope: [], assumptions: [], risks: [], qualityGates: ['telegram_smoke'] },
        dagPreview: { nodes: [{ id: 'pf-ochag/notify', kind: 'ochag.telegram_notify' }] },
        deliveryChecklist: ['telegram_message_preview'],
      },
      artifact: { id: 'artifact-ochag' },
    });
    mockGetOchagPrivacy.mockResolvedValue({
      domainId: 'ochag',
      privacyRules: [{ id: 'member-private-memory' }, { id: 'family-visibility-boundary' }],
      toolPermissionOverrides: { telegram_send: 'ask_once' },
      adapterRegistrations: [{ target: 'telegram' }],
    });
    mockPreviewCeoclawBrief.mockResolvedValue({
      preview: {
        intent: { id: 'pf-ceoclaw', templateId: 'business_brief', title: 'Approve evidence-backed project action', goal: 'Approve evidence-backed project action', domainIds: ['ceoclaw'] },
        template: { id: 'business_brief', title: 'Business/CEO brief' },
        missingClarifications: [],
        scopedPlan: { objective: 'Approve evidence-backed project action', scope: [], assumptions: [], risks: [], qualityGates: ['evidence_check'] },
        dagPreview: { nodes: [{ id: 'pf-ceoclaw/approval', kind: 'ceoclaw.request_approval' }] },
        deliveryChecklist: ['executive_summary'],
      },
    });
    mockCreateCeoclawBriefRun.mockResolvedValue({
      run: {
        run_id: 'run-ceoclaw',
        task_id: 'pf-ceoclaw',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'planned',
        artifact_refs: ['artifact-ceoclaw'],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
      preview: {
        intent: { id: 'pf-ceoclaw', templateId: 'business_brief', title: 'Approve evidence-backed project action', goal: 'Approve evidence-backed project action', domainIds: ['ceoclaw'] },
        template: { id: 'business_brief', title: 'Business/CEO brief' },
        missingClarifications: [],
        scopedPlan: { objective: 'Approve evidence-backed project action', scope: [], assumptions: [], risks: [], qualityGates: ['evidence_check'] },
        dagPreview: { nodes: [{ id: 'pf-ceoclaw/approval', kind: 'ceoclaw.request_approval' }] },
        deliveryChecklist: ['executive_summary'],
      },
      artifact: { id: 'artifact-ceoclaw' },
    });
    mockGetRun.mockResolvedValue({
      run: {
        run_id: 'run-1',
        task_id: 'Build product',
        workspace_id: 'workspace-1',
        repo_id: 'repo-1',
        branch_or_worktree_id: 'main',
        mode: 'pm',
        status: 'running',
        artifact_refs: [],
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:05:00.000Z',
      },
    });
    mockGetRunDeliveryEvidence.mockResolvedValue({
      artifact: { id: 'artifact-evidence', kind: 'delivery_evidence', createdAt: '2026-05-01T00:06:00.000Z', uri: '/private/path' },
      snapshot: {
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        capturedAt: '2026-05-01T00:06:00.000Z',
        runId: 'run-1',
        verifierStatus: 'warning',
        deliveryChecklist: ['implementation_summary', 'tests'],
        git: {
          available: true,
          branch: 'main',
          headSha: '1234567890abcdef',
          ahead: 0,
          behind: 0,
          dirtyFiles: [],
          latestCommits: [],
          remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
        },
        github: {
          provider: 'github',
          available: true,
          repository: 'acme/pyrfor',
          branch: { name: 'main', commitSha: '1234567890abcdef' },
          issue: { number: 5, title: 'Track delivery', state: 'open', url: 'https://github.com/acme/pyrfor/issues/5' },
          pullRequests: [{ number: 42, title: 'Ship Product Factory', state: 'open', url: 'https://github.com/acme/pyrfor/pull/42' }],
          workflowRuns: [{ id: 7, name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/pyrfor/actions/runs/7' }],
          errors: [],
        },
      },
    });
    mockListRunEvents.mockResolvedValue({
      events: [
        { id: 'event-1', ts: '2026-05-01T00:01:00.000Z', type: 'run.created' },
        { id: 'event-2', ts: '2026-05-01T00:02:00.000Z', type: 'effect.proposed', effect_id: 'effect-1' },
        { id: 'event-3', ts: '2026-05-01T00:03:00.000Z', type: 'verifier.completed', status: 'warning', reason: 'tests pending' },
      ],
    });
    mockListRunDag.mockResolvedValue({
      nodes: [
        {
          id: 'node-1',
          kind: 'workflow.step',
          status: 'running',
          dependsOn: [],
          payload: { runId: 'run-1' },
          provenance: [],
        },
      ],
    });
    mockListRunFrames.mockResolvedValue({
      frames: [{ nodeId: 'frame-node-1', frame_id: 'frame-1', type: 'tool_call', disposition: 'applied', seq: 1 }],
    });
    mockCaptureRunDeliveryEvidence.mockResolvedValue({
      artifact: { id: 'artifact-evidence-new', kind: 'delivery_evidence' },
      snapshot: {
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        capturedAt: '2026-05-01T00:07:00.000Z',
        runId: 'run-1',
        verifierStatus: 'passed',
        deliveryChecklist: ['release_notes'],
        git: {
          available: true,
          branch: 'feature/evidence',
          headSha: 'abcdef1234567890',
          ahead: 1,
          behind: 0,
          dirtyFiles: [],
          latestCommits: [],
          remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
        },
        github: {
          provider: 'github',
          available: true,
          repository: 'acme/pyrfor',
          branch: { name: 'feature/evidence', commitSha: 'abcdef1234567890' },
          issue: { number: 42, title: 'Capture evidence', state: 'open', url: 'https://github.com/acme/pyrfor/issues/42' },
          pullRequests: [],
          workflowRuns: [],
          errors: [],
        },
      },
    });
    mockGetRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', createdAt: '2026-05-01T00:08:00.000Z', uri: '/private/path' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:08:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: false,
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
        proposedBranch: 'pyrfor/build-product-12345678',
        pullRequest: { title: 'Pyrfor delivery: Build product', body: 'No writes', draft: true },
        issue: { number: 5, commentBody: 'Dry-run plan' },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
        evidenceArtifactId: 'artifact-evidence',
      },
    });
    mockCreateRunGithubDeliveryPlan.mockResolvedValue({
      artifact: { id: 'artifact-plan-new', kind: 'delivery_plan' },
      plan: {
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        createdAt: '2026-05-01T00:09:00.000Z',
        runId: 'run-1',
        mode: 'dry_run',
        applySupported: false,
        repository: 'acme/pyrfor',
        baseBranch: 'feature/evidence',
        headSha: 'abcdef1234567890',
        proposedBranch: 'pyrfor/capture-evidence-abcdef12',
        pullRequest: { title: 'Pyrfor delivery: Capture evidence', body: 'No writes', draft: true },
        issue: { number: 42, commentBody: 'Dry-run plan' },
        ci: { observeWorkflowRuns: [] },
        blockers: [],
      },
    });
    mockControlRun.mockResolvedValue({ ok: true, action: 'replay', run: { run_id: 'run-1' } });
    mockGetOverlay.mockResolvedValue({
      overlay: {
        schemaVersion: 'domain_overlay.v1',
        domainId: 'ochag',
        version: '1.0.0',
        title: 'Ochag',
        workflowTemplates: [{ id: 'family-reminder' }],
        adapterRegistrations: [{ id: 'telegram' }],
        privacyRules: [{ id: 'member-private-memory' }],
      },
    });
  });

  it('renders dashboard summary, runs, and overlays', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => {
      expect(screen.getByText('1 total / 1 active')).toBeTruthy();
      expect(screen.getByText('Build product')).toBeTruthy();
      expect(screen.getByText('CEOClaw')).toBeTruthy();
      expect(screen.getByText('Ochag')).toBeTruthy();
      expect(screen.getByText('Product Factory')).toBeTruthy();
      expect(screen.getByText('Feature delivery')).toBeTruthy();
      expect(screen.getByText('Ochag family assistant')).toBeTruthy();
      expect(screen.getByText('CEOClaw business overlay')).toBeTruthy();
      expect(screen.getByText(/network_write:deny/)).toBeTruthy();
      expect(screen.getByText(/member-private-memory/)).toBeTruthy();
      expect(screen.getByText('2 pending')).toBeTruthy();
      expect(screen.getByText('3 total')).toBeTruthy();
      expect(screen.getByText('warning')).toBeTruthy();
    });
  });

  it('loads run details when a run is selected', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));

    await waitFor(() => {
      expect(mockGetRun).toHaveBeenCalledWith('run-1');
      expect(mockListRunEvents).toHaveBeenCalledWith('run-1');
      expect(mockListRunDag).toHaveBeenCalledWith('run-1');
      expect(mockListRunFrames).toHaveBeenCalledWith('run-1');
      expect(mockGetRunDeliveryEvidence).toHaveBeenCalledWith('run-1');
      expect(mockGetRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('run.created')).toBeTruthy();
      expect(screen.getByText('workflow.step')).toBeTruthy();
      expect(screen.getByText('tool_call')).toBeTruthy();
      expect(screen.getAllByText('effect.proposed').length).toBeGreaterThan(0);
      expect(screen.getByText('tests pending')).toBeTruthy();
      expect(screen.getAllByText('acme/pyrfor').length).toBeGreaterThan(0);
      expect(screen.getByText('Issue #5')).toBeTruthy();
      expect(screen.getByText('Track delivery')).toBeTruthy();
      expect(screen.getByText('PR #42')).toBeTruthy();
      expect(screen.getByText('CI')).toBeTruthy();
      expect(screen.getByText(/implementation_summary, tests/)).toBeTruthy();
      expect(screen.getByText('pyrfor/build-product-12345678')).toBeTruthy();
      expect(screen.getByText('Pyrfor delivery: Build product')).toBeTruthy();
    });
  });

  it('captures delivery evidence for the selected run', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Capture evidence')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/GitHub issue #/i), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Capture evidence/i }));

    await waitFor(() => {
      expect(mockCaptureRunDeliveryEvidence).toHaveBeenCalledWith('run-1', { issueNumber: 42 });
      expect(screen.getByText(/feature\/evidence/)).toBeTruthy();
      expect(screen.getByText('Issue #42')).toBeTruthy();
      expect(screen.getByText(/release_notes/)).toBeTruthy();
    });
  });

  it('creates a dry-run GitHub delivery plan for the selected run', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Build product')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Build product/i }));
    await waitFor(() => expect(screen.getByText('Plan GitHub delivery')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/GitHub issue #/i), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Plan GitHub delivery/i }));

    await waitFor(() => {
      expect(mockCreateRunGithubDeliveryPlan).toHaveBeenCalledWith('run-1', { issueNumber: 42 });
      expect(screen.getByText('pyrfor/capture-evidence-abcdef12')).toBeTruthy();
      expect(screen.getByText('Pyrfor delivery: Capture evidence')).toBeTruthy();
      expect(screen.getByText('links issue #42')).toBeTruthy();
    });
  });

  it('loads overlay details when an overlay is selected', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /Ochag/i }).find((button) => (
      button.className === 'orchestration-row'
    ))!);

    await waitFor(() => {
      expect(mockGetOverlay).toHaveBeenCalledWith('ochag');
      expect(screen.getByText('1 workflows / 1 adapters')).toBeTruthy();
      expect(screen.getByText(/Privacy rules: member-private-memory/)).toBeTruthy();
      expect(screen.getByText(/family-reminder/)).toBeTruthy();
    });
  });

  it('previews product factory plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Feature delivery')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview plan/i }));

    await waitFor(() => {
      expect(mockPreviewProductFactoryPlan).toHaveBeenCalledWith({
        templateId: 'feature',
        prompt: 'Describe the product idea or task to plan',
        answers: {
          acceptance: 'Visible outcome is available in the operator console.',
        },
      });
      expect(screen.getByText('Build delivery package')).toBeTruthy();
      expect(screen.getByText(/product_factory\.scoped_plan/)).toBeTruthy();
      expect(screen.getByText(/implementation_summary/)).toBeTruthy();
    });
  });

  it('creates product factory runs with required clarification answers', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Feature delivery')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Create run$/i }));

    await waitFor(() => {
      expect(mockCreateProductFactoryRun).toHaveBeenCalledWith({
        templateId: 'feature',
        prompt: 'Describe the product idea or task to plan',
        answers: {
          acceptance: 'Visible outcome is available in the operator console.',
        },
      });
    });
  });

  it('previews Ochag family reminder plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag family assistant')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview Ochag reminder/i }));

    await waitFor(() => {
      expect(mockPreviewOchagReminder).toHaveBeenCalledWith({
        title: 'Send dinner reminder',
        familyId: 'family-1',
        dueAt: '18:00 today',
        audience: 'family',
        visibility: 'family',
      });
      expect(screen.getByText('Send dinner reminder')).toBeTruthy();
      expect(screen.getByText(/ochag\.telegram_notify/)).toBeTruthy();
      expect(screen.getByText(/telegram_message_preview/)).toBeTruthy();
    });
  });

  it('creates Ochag reminder runs with family context', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('Ochag family assistant')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create Ochag run/i }));

    await waitFor(() => {
      expect(mockCreateOchagReminderRun).toHaveBeenCalledWith({
        title: 'Send dinner reminder',
        familyId: 'family-1',
        dueAt: '18:00 today',
        audience: 'family',
        visibility: 'family',
      });
    });
  });

  it('previews CEOClaw business brief plans', async () => {
    render(<OrchestrationPanel />);

    await waitFor(() => expect(screen.getByText('CEOClaw business overlay')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Preview CEOClaw brief/i }));

    await waitFor(() => {
      expect(mockPreviewCeoclawBrief).toHaveBeenCalledWith({
        decision: 'Approve evidence-backed project action',
        evidence: 'evidence-1',
        deadline: 'this week',
      });
      expect(screen.getByText('Approve evidence-backed project action')).toBeTruthy();
      expect(screen.getByText(/ceoclaw\.request_approval/)).toBeTruthy();
      expect(screen.getByText(/executive_summary/)).toBeTruthy();
    });
  });
});
