/**
 * federated-skills.ts — Pyrfor federated skill-sharing module.
 *
 * Peers exchange FederatedSkill definitions over HTTP:
 *   GET  ${peer.url}/skills   → FederatedSkill[]   (served by exportLocal())
 *
 * Signature model:
 *   - publish() signs payload with SHA-256( JSON.stringify(payload) + nodeId )
 *   - syncFromPeer() verifies incoming skills: if custom verifier is provided,
 *     always call it; otherwise use the default SHA-256 verifier only when the
 *     remote skill carries a signature field.
 *
 * Timeout: uses Promise.race + setTimeout so vitest fake timers work correctly.
 */
export type FederatedSkill = {
    id: string;
    name: string;
    version: number;
    payload: unknown;
    signature?: string;
    sourceNodeId: string;
    receivedAt?: number;
};
export type Peer = {
    id: string;
    url: string;
    lastSyncAt?: number;
    lastError?: string;
};
export type EventName = 'peerAdded' | 'peerRemoved' | 'syncStart' | 'syncEnd' | 'syncError' | 'skillReceived' | 'skillRejected';
export type LocalStore = {
    list(): FederatedSkill[];
    upsert(s: FederatedSkill): void;
    get(id: string): FederatedSkill | undefined;
};
export type FederatedSkillsClientOpts = {
    nodeId: string;
    httpFetch?: typeof fetch;
    signer?: (payload: unknown) => string;
    verifier?: (payload: unknown, sig: string, sourceNodeId: string) => boolean;
    localStore: LocalStore;
    timeoutMs?: number;
};
export type SyncPeerResult = {
    peer: string;
    pulled: number;
    rejected: number;
    error?: string;
};
export type FederatedSkillsClient = ReturnType<typeof createFederatedSkillsClient>;
export declare function createFederatedSkillsClient(opts: FederatedSkillsClientOpts): {
    addPeer: (peer: Peer) => void;
    removePeer: (peerId: string) => void;
    listPeers: () => Peer[];
    publish: (skill: Omit<FederatedSkill, "sourceNodeId" | "signature" | "receivedAt">) => FederatedSkill;
    syncFromPeer: (peerId: string) => Promise<{
        pulled: number;
        rejected: number;
    }>;
    syncFromAllPeers: () => Promise<SyncPeerResult[]>;
    exportLocal: () => FederatedSkill[];
    on: (event: EventName, cb: (payload?: unknown) => void) => () => void;
};
//# sourceMappingURL=federated-skills.d.ts.map