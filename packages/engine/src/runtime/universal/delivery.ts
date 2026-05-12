import { createHash } from 'node:crypto';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';

export interface DeliveryManifestArtifactRef {
  id: string;
  kind: string;
  sha256?: string;
  bytes?: number;
  runId?: string;
  meta?: Record<string, unknown>;
}

export interface DeliveryManifest {
  schemaVersion: 'pyrfor.delivery_manifest.v1';
  conceptId: string;
  runId: string;
  createdAt: string;
  artifactRefs: DeliveryManifestArtifactRef[];
  checksum: string;
  verifierStatus?: string;
  summary?: string;
}

export interface DeliveryBundleDocument {
  schemaVersion: 'pyrfor.delivery_bundle.v1';
  conceptId: string;
  runId: string;
  createdAt: string;
  manifest: DeliveryManifest;
  manifestRef: DeliveryManifestArtifactRef;
  artifactRefs: DeliveryManifestArtifactRef[];
}

export interface DeliveryBundle {
  manifest: DeliveryManifest;
  manifestRef: ArtifactRef;
  bundleArtifactRef: ArtifactRef;
  bundle: DeliveryBundleDocument;
}

export interface DeliveryPackagerDeps {
  artifactStore: ArtifactStore;
  ledger: EventLedger;
  clock?: () => number;
}

export interface DeliveryPackagerInput {
  conceptId: string;
  runId: string;
  artifactRefs: ArtifactRef[];
  summary?: string;
  verifierStatus?: string;
}

export class DeliveryPackagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryPackagerError';
  }
}

export function buildDeliveryManifest(input: DeliveryPackagerInput, clock: () => number = Date.now): DeliveryManifest {
  validateDeliveryInput(input);
  const artifactRefs = input.artifactRefs
    .map(toManifestRef)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 'pyrfor.delivery_manifest.v1',
    conceptId: input.conceptId,
    runId: input.runId,
    createdAt: new Date(clock()).toISOString(),
    artifactRefs,
    checksum: checksumArtifacts(artifactRefs),
    ...(input.verifierStatus ? { verifierStatus: input.verifierStatus } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
  };
}

export async function runDeliveryPackager(
  input: DeliveryPackagerInput,
  deps: DeliveryPackagerDeps,
): Promise<DeliveryBundle> {
  validateDeliveryInput(input);
  await deps.ledger.append({
    type: 'delivery.started',
    run_id: input.runId,
    concept_id: input.conceptId,
    artifact_count: input.artifactRefs.length,
  });

  const manifest = buildDeliveryManifest(input, deps.clock);
  const manifestRef = await deps.artifactStore.writeJSON('artifact_manifest', manifest, {
    runId: input.runId,
    meta: { conceptId: input.conceptId, checksum: manifest.checksum },
  });
  const bundle: DeliveryBundleDocument = {
    schemaVersion: 'pyrfor.delivery_bundle.v1',
    conceptId: input.conceptId,
    runId: input.runId,
    createdAt: manifest.createdAt,
    manifest,
    manifestRef: toManifestRef(manifestRef),
    artifactRefs: manifest.artifactRefs,
  };
  const bundleArtifactRef = await deps.artifactStore.writeJSON('delivery_bundle', bundle, {
    runId: input.runId,
    meta: {
      conceptId: input.conceptId,
      manifestArtifactId: manifestRef.id,
      checksum: manifest.checksum,
    },
  });

  await deps.ledger.append({
    type: 'delivery.completed',
    run_id: input.runId,
    concept_id: input.conceptId,
    artifact_count: input.artifactRefs.length,
    bundle_artifact_id: bundleArtifactRef.id,
    manifest_artifact_id: manifestRef.id,
    artifact_id: bundleArtifactRef.id,
    status: 'completed',
  });

  return { manifest, manifestRef, bundleArtifactRef, bundle };
}

function validateDeliveryInput(input: DeliveryPackagerInput): void {
  if (!input.conceptId.trim()) throw new DeliveryPackagerError('conceptId is required');
  if (!input.runId.trim()) throw new DeliveryPackagerError('runId is required');
  const missingSha = input.artifactRefs.find((ref) => !ref.sha256);
  if (missingSha) throw new DeliveryPackagerError(`artifact sha256 is required: ${missingSha.id}`);
}

function toManifestRef(ref: ArtifactRef): DeliveryManifestArtifactRef {
  return {
    id: ref.id,
    kind: ref.kind,
    ...(ref.sha256 ? { sha256: ref.sha256 } : {}),
    ...(ref.bytes !== undefined ? { bytes: ref.bytes } : {}),
    ...(ref.runId ? { runId: ref.runId } : {}),
    ...(ref.meta ? { meta: ref.meta } : {}),
  };
}

function checksumArtifacts(refs: DeliveryManifestArtifactRef[]): string {
  const material = refs
    .map((ref) => `${ref.id}:${ref.kind}:${ref.sha256}`)
    .join('\n');
  return createHash('sha256').update(material).digest('hex');
}
