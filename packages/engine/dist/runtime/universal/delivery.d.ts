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
export declare class DeliveryPackagerError extends Error {
    constructor(message: string);
}
export declare function buildDeliveryManifest(input: DeliveryPackagerInput, clock?: () => number): DeliveryManifest;
export declare function runDeliveryPackager(input: DeliveryPackagerInput, deps: DeliveryPackagerDeps): Promise<DeliveryBundle>;
//# sourceMappingURL=delivery.d.ts.map