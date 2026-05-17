export declare const BLOCK_MANIFEST_VERSION = "1";
export declare const BLOCK_MANIFEST_FILENAME = "block.json";
export type BlockRuntimeMode = 'trusted-core' | 'local-worker' | 'wasm' | 'container' | 'remote';
export type BlockSandbox = 'none' | 'process-isolated' | 'wasm-wasi' | 'container-oci';
export type BlockCertificationState = 'dev' | 'internal' | 'pilot' | 'certified' | 'revoked';
export type BlockPanelSlot = 'left' | 'center' | 'right' | 'bottom' | 'modal' | 'sidebar';
export interface BlockCapability {
    token: string;
    reason: string;
    scope?: 'project' | 'block' | 'global' | string;
    expires_after_run?: boolean;
}
export interface BlockContractRef {
    ref: string;
    from?: string;
    optional?: boolean;
}
export interface BlockContractSchemaMetadata {
    path?: string;
    uri?: string;
    mediaType?: string;
    sha256?: string;
    validate?: boolean;
}
export interface BlockProducedContractRef extends BlockContractRef {
    schema?: BlockContractSchemaMetadata;
}
export interface BlockPanel {
    id: string;
    slot: BlockPanelSlot;
    label: string;
    entry: string;
    requires_capabilities?: string[];
}
export interface BlockManifest {
    $schema?: string;
    pyrfor_manifest_version: typeof BLOCK_MANIFEST_VERSION;
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    runtime: {
        mode: BlockRuntimeMode;
        engine_version_range: string;
        node_version_range?: string;
        sandbox: BlockSandbox;
    };
    entrypoints: {
        main: string;
        worker?: string;
        ui?: string;
        a2a_agent_card?: string;
        mcp_server?: string;
    };
    scripts: {
        test: string;
        install?: string;
        activate?: string;
        deactivate?: string;
        upgrade?: string;
        rollback?: string;
        uninstall?: string;
    };
    capabilities: BlockCapability[];
    contracts: {
        consumes: BlockContractRef[];
        produces: BlockProducedContractRef[];
    };
    events?: {
        publishes?: string[];
        subscribes?: string[];
    };
    panels?: BlockPanel[];
    memory_scope?: {
        project_shared?: string[];
        block_private?: string[];
        global_shared?: string[];
    };
    artifact_types?: string[];
    optimizer_policy: {
        editable: boolean;
        editable_fields?: string[];
        never_editable?: string[];
        requires_human_approval?: string[];
    };
    security: {
        sandbox: BlockSandbox;
        allow_fs_read: string[];
        allow_fs_write: string[];
        allow_network: boolean;
        allow_child_process: boolean;
        secrets_access: string[];
        max_memory_mb: number;
        max_cpu_pct: number;
    };
    signing?: {
        algorithm: 'ed25519' | string;
        key_id: string;
        signature_file: string;
    };
    certification: {
        state: BlockCertificationState;
        certified_by?: string;
        certified_at?: string;
        sbom?: string;
        notes?: string;
    };
}
export interface BlockManifestIssue {
    path: string;
    code: string;
    message: string;
}
export interface BlockPackageValidationReport {
    status: 'valid' | 'invalid';
    rootDir: string;
    manifestPath: string;
    manifest?: BlockManifest;
    errors: BlockManifestIssue[];
    warnings: BlockManifestIssue[];
    summary: {
        id?: string;
        version?: string;
        capabilityCount: number;
        consumedContractCount: number;
        producedContractCount: number;
        panelCount: number;
        certificationState?: BlockCertificationState;
    };
}
export declare class BlockManifestError extends Error {
    readonly code: string;
    readonly manifestPath?: string | undefined;
    constructor(message: string, code: string, manifestPath?: string | undefined);
}
export declare function loadBlockManifest(inputPath: string): Promise<{
    rootDir: string;
    manifestPath: string;
    manifest: BlockManifest;
}>;
export declare function validateBlockPackage(inputPath: string): Promise<BlockPackageValidationReport>;
//# sourceMappingURL=block-manifest.d.ts.map