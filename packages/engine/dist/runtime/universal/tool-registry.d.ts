export type ToolKind = 'script' | 'api_client' | 'mcp_tool' | 'wasm_module' | 'skill';
export type ToolStatus = 'pending_validation' | 'sandboxed_experiment' | 'vetted' | 'trusted' | 'core' | 'retired';
export type SandboxTier = 'wasm' | 'container_no_net' | 'container_net_allowlist' | 'container_full' | 'host';
export interface ToolCapabilityManifest {
    description: string;
    triggers: string[];
    inputSchema: object;
    outputSchema: object;
    declaredEffects: Array<'fs.read' | 'fs.write' | 'net.out' | 'net.in' | 'process.spawn' | 'env.read' | 'time'>;
    requiredTrustTier: ToolStatus;
    requiredSandboxTier: SandboxTier;
    egressAllowlist?: string[];
    fsScope?: string[];
    perCallBudget?: {
        tokensUSD?: number;
        wallMs?: number;
        egressKB?: number;
    };
}
export interface ToolTrustTransition {
    at: string;
    from: ToolStatus;
    to: ToolStatus;
    reason: string;
    runId?: string;
}
export interface RegistryEntry {
    id: string;
    name: string;
    kind: ToolKind;
    status: ToolStatus;
    capability: ToolCapabilityManifest;
    implPath: string;
    contentHash: string;
    signature?: string;
    artifactId: string;
    testSuiteArtifactId: string;
    lastTestResultArtifactId?: string;
    forgedByConceptId?: string;
    parentToolId?: string;
    version: number;
    trustHistory: ToolTrustTransition[];
    failureScore: number;
    createdAt: string;
    updatedAt: string;
    retiredAt?: string;
    tags: string[];
}
export type RegisterToolInput = Omit<RegistryEntry, 'id' | 'status' | 'version' | 'trustHistory' | 'failureScore' | 'createdAt' | 'updatedAt' | 'retiredAt'> & {
    status?: ToolStatus;
    failureScore?: number;
    trustHistory?: ToolTrustTransition[];
};
export interface ToolRegistryQuery {
    kind?: ToolKind;
    status?: ToolStatus | 'active';
    q?: string;
    tags?: string[];
    limit?: number;
}
export interface ToolRegistry {
    register(input: RegisterToolInput): RegistryEntry;
    registerWithDisposition(input: RegisterToolInput): {
        entry: RegistryEntry;
        created: boolean;
    };
    find(query?: ToolRegistryQuery): RegistryEntry[];
    get(id: string): RegistryEntry | undefined;
    getByName(name: string): RegistryEntry | undefined;
    retire(id: string, reason?: string): RegistryEntry | undefined;
    loadAll(): RegistryEntry[];
}
export declare class JsonlToolRegistry implements ToolRegistry {
    private readonly filePath;
    constructor(dir?: string);
    register(input: RegisterToolInput): RegistryEntry;
    registerWithDisposition(input: RegisterToolInput): {
        entry: RegistryEntry;
        created: boolean;
    };
    find(query?: ToolRegistryQuery): RegistryEntry[];
    get(id: string): RegistryEntry | undefined;
    getByName(name: string): RegistryEntry | undefined;
    retire(id: string, reason?: string): RegistryEntry | undefined;
    loadAll(): RegistryEntry[];
    private readAll;
    private writeAll;
}
export declare function createToolRegistry(dir?: string): ToolRegistry;
//# sourceMappingURL=tool-registry.d.ts.map