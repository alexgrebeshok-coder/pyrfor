import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore, type ArtifactRef } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import type { ConceptRecord } from './engine-loop';
import { buildPostMortem, runPostMortem, type RunPostMortem } from './postmortem';

describe('PostMortem', () => {
  let dir: string;
  let artifactStore: ArtifactStore;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-postmortem-'));
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds postmortem report from concept record and phase artifacts', () => {
    const report = buildPostMortem({
      conceptRecord: conceptRecord({
        artifactRefs: [artifact('plan-1', 'plan'), artifact('test-1', 'test_result')],
      }),
      outcome: 'completed',
      summary: 'delivered successfully',
      whatWorked: ['tests passed'],
      toolsUsed: ['tester'],
      deliveryBundleRef: 'bundle-1',
    }, () => 0);

    expect(report).toMatchObject({
      schemaVersion: 'pyrfor.postmortem.v1',
      runId: 'run-1',
      conceptId: 'concept-1',
      outcome: 'completed',
      createdAt: '1970-01-01T00:00:00.000Z',
      phaseArtifactRefs: ['plan-1', 'test-1'],
      deliveryBundleRef: 'bundle-1',
    });
  });

  it('records failed concept errors in whatFailed and error fields', () => {
    const report = buildPostMortem({
      conceptRecord: conceptRecord({ status: 'failed', error: 'verification failed' }),
      outcome: 'failed',
      summary: 'failed during verification',
    }, () => 0);

    expect(report.whatFailed).toEqual(['verification failed']);
    expect(report.error).toBe('verification failed');
  });

  it('writes postmortem_report artifact and emits ledger events', async () => {
    const ref = await runPostMortem({
      conceptRecord: conceptRecord({ artifactRefs: [artifact('bundle-1', 'delivery_bundle')] }),
      outcome: 'completed',
      summary: 'done',
      deliveryBundleRef: 'bundle-1',
      memoryWriteRecommendations: [{ kind: 'episode', summary: 'reuse this delivery path', evidenceRef: 'bundle-1' }],
    }, { artifactStore, ledger, clock: () => 0 });

    expect(ref.kind).toBe('postmortem_report');
    const report = await artifactStore.readJSONVerified<RunPostMortem>(ref, ref.sha256!);
    expect(report).toMatchObject({
      deliveryBundleRef: 'bundle-1',
      memoryWriteRecommendations: [{ evidenceRef: 'bundle-1' }],
    });
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['postmortem.started', 'postmortem.completed']);
    expect((await ledger.readAll())[1]).toMatchObject({ artifact_id: ref.id, status: 'completed' });
  });
});

function conceptRecord(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    conceptId: 'concept-1',
    runId: 'run-1',
    goal: 'ship a working feature',
    status: 'done',
    phases: ['plan', 'execute', 'critique'],
    artifactRefs: [],
    createdAt: '1970-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function artifact(id: string, kind: ArtifactRef['kind']): ArtifactRef {
  return {
    id,
    kind,
    uri: `/tmp/${id}`,
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}
