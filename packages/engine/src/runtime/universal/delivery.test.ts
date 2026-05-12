import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore, type ArtifactRef } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import {
  buildDeliveryManifest,
  runDeliveryPackager,
  type DeliveryBundleDocument,
  type DeliveryManifest,
} from './delivery';

describe('DeliveryPackager', () => {
  let dir: string;
  let artifactStore: ArtifactStore;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-delivery-'));
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds deterministic manifests by sorting artifact refs before checksumming', () => {
    const refs = [
      ref({ id: 'z-artifact', sha256: 'sha-z' }),
      ref({ id: 'a-artifact', sha256: 'sha-a' }),
    ];

    const first = buildDeliveryManifest({ conceptId: 'concept-1', runId: 'run-1', artifactRefs: refs }, () => 0);
    const second = buildDeliveryManifest({ conceptId: 'concept-1', runId: 'run-1', artifactRefs: [...refs].reverse() }, () => 0);

    expect(first).toEqual(second);
    expect(first.artifactRefs.map((artifact) => artifact.id)).toEqual(['a-artifact', 'z-artifact']);
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes checksum when artifact id, kind, or sha256 changes', () => {
    const base = buildDeliveryManifest({ conceptId: 'concept-1', runId: 'run-1', artifactRefs: [ref({ id: 'a', kind: 'summary', sha256: 'sha-a' })] }, () => 0);
    const changed = buildDeliveryManifest({
      conceptId: 'concept-1',
      runId: 'run-1',
      artifactRefs: [ref({ id: 'a', kind: 'delivery_evidence', sha256: 'sha-a' })],
    }, () => 0);

    expect(base.checksum).not.toBe(changed.checksum);
  });

  it('rejects artifacts without sha256 instead of claiming unverifiable integrity', () => {
    expect(() => buildDeliveryManifest({
      conceptId: 'concept-1',
      runId: 'run-1',
      artifactRefs: [ref({ id: 'a', sha256: undefined })],
    }, () => 0)).toThrow(/sha256 is required/);
  });

  it('writes manifest and delivery bundle artifacts with verified JSON content', async () => {
    const execution = await artifactStore.writeJSON('sandbox_result', { ok: true }, { runId: 'run-1' });
    const tests = await artifactStore.writeJSON('test_result', { status: 'passed' }, { runId: 'run-1' });

    const delivery = await runDeliveryPackager({
      conceptId: 'concept-1',
      runId: 'run-1',
      artifactRefs: [tests, execution],
      summary: 'ready to deliver',
      verifierStatus: 'passed',
    }, { artifactStore, ledger, clock: () => 0 });

    expect(delivery.manifestRef.kind).toBe('artifact_manifest');
    expect(delivery.bundleArtifactRef.kind).toBe('delivery_bundle');
    const manifest = await artifactStore.readJSONVerified<DeliveryManifest>(delivery.manifestRef, delivery.manifestRef.sha256!);
    const bundle = await artifactStore.readJSONVerified<DeliveryBundleDocument>(delivery.bundleArtifactRef, delivery.bundleArtifactRef.sha256!);
    expect(manifest).toMatchObject({ conceptId: 'concept-1', checksum: delivery.manifest.checksum });
    expect(bundle).toMatchObject({
      schemaVersion: 'pyrfor.delivery_bundle.v1',
      manifestRef: { id: delivery.manifestRef.id },
      manifest: { checksum: delivery.manifest.checksum },
    });
    expect(JSON.stringify(bundle)).not.toContain(delivery.manifestRef.uri);
    await expect(artifactStore.list({ runId: 'run-1', kind: 'artifact_manifest' })).resolves.toHaveLength(1);
    await expect(artifactStore.list({ runId: 'run-1', kind: 'delivery_bundle' })).resolves.toHaveLength(1);
  });

  it('emits delivery started and completed events', async () => {
    const artifact = await artifactStore.writeJSON('summary', { ok: true }, { runId: 'run-1' });

    const delivery = await runDeliveryPackager({
      conceptId: 'concept-1',
      runId: 'run-1',
      artifactRefs: [artifact],
    }, { artifactStore, ledger });

    const events = await ledger.readAll();
    expect(events.map((event) => event.type)).toEqual(['delivery.started', 'delivery.completed']);
    expect(events[1]).toMatchObject({
      bundle_artifact_id: delivery.bundleArtifactRef.id,
      manifest_artifact_id: delivery.manifestRef.id,
      artifact_count: 1,
    });
  });
});

function ref(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    id: 'artifact-1',
    kind: 'summary',
    uri: '/tmp/artifact-1',
    createdAt: '1970-01-01T00:00:00.000Z',
    ...overrides,
  };
}
