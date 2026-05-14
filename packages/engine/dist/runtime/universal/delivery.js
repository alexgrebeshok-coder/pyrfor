var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
export class DeliveryPackagerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DeliveryPackagerError';
    }
}
export function buildDeliveryManifest(input, clock = Date.now) {
    validateDeliveryInput(input);
    const artifactRefs = input.artifactRefs
        .map(toManifestRef)
        .sort((a, b) => a.id.localeCompare(b.id));
    return Object.assign(Object.assign({ schemaVersion: 'pyrfor.delivery_manifest.v1', conceptId: input.conceptId, runId: input.runId, createdAt: new Date(clock()).toISOString(), artifactRefs, checksum: checksumArtifacts(artifactRefs) }, (input.verifierStatus ? { verifierStatus: input.verifierStatus } : {})), (input.summary ? { summary: input.summary } : {}));
}
export function runDeliveryPackager(input, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        validateDeliveryInput(input);
        yield deps.ledger.append({
            type: 'delivery.started',
            run_id: input.runId,
            concept_id: input.conceptId,
            artifact_count: input.artifactRefs.length,
        });
        const manifest = buildDeliveryManifest(input, deps.clock);
        const manifestRef = yield deps.artifactStore.writeJSON('artifact_manifest', manifest, {
            runId: input.runId,
            meta: { conceptId: input.conceptId, checksum: manifest.checksum },
        });
        const bundle = {
            schemaVersion: 'pyrfor.delivery_bundle.v1',
            conceptId: input.conceptId,
            runId: input.runId,
            createdAt: manifest.createdAt,
            manifest,
            manifestRef: toManifestRef(manifestRef),
            artifactRefs: manifest.artifactRefs,
        };
        const bundleArtifactRef = yield deps.artifactStore.writeJSON('delivery_bundle', bundle, {
            runId: input.runId,
            meta: {
                conceptId: input.conceptId,
                manifestArtifactId: manifestRef.id,
                checksum: manifest.checksum,
            },
        });
        yield deps.ledger.append({
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
    });
}
function validateDeliveryInput(input) {
    if (!input.conceptId.trim())
        throw new DeliveryPackagerError('conceptId is required');
    if (!input.runId.trim())
        throw new DeliveryPackagerError('runId is required');
    const missingSha = input.artifactRefs.find((ref) => !ref.sha256);
    if (missingSha)
        throw new DeliveryPackagerError(`artifact sha256 is required: ${missingSha.id}`);
}
function toManifestRef(ref) {
    return Object.assign(Object.assign(Object.assign(Object.assign({ id: ref.id, kind: ref.kind }, (ref.sha256 ? { sha256: ref.sha256 } : {})), (ref.bytes !== undefined ? { bytes: ref.bytes } : {})), (ref.runId ? { runId: ref.runId } : {})), (ref.meta ? { meta: ref.meta } : {}));
}
function checksumArtifacts(refs) {
    const material = refs
        .map((ref) => `${ref.id}:${ref.kind}:${ref.sha256}`)
        .join('\n');
    return createHash('sha256').update(material).digest('hex');
}
