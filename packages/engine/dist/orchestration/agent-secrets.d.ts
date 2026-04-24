/**
 * Agent Secrets — encrypted key-value storage for sensitive agent configuration.
 *
 * Uses AES-256-GCM with a workspace-derived key.
 * Secrets can be referenced in adapterConfig as ${secret:KEY_NAME}.
 */
export declare function setSecret(workspaceId: string, key: string, value: string, agentId?: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    key: string;
    workspaceId: string;
    agentId: string | null;
    encValue: string;
    iv: string;
    tag: string;
}>;
export declare function getSecret(workspaceId: string, key: string): Promise<string | null>;
export declare function listSecrets(workspaceId: string, agentId?: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    key: string;
    agentId: string | null;
}[]>;
export declare function deleteSecret(workspaceId: string, key: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    key: string;
    workspaceId: string;
    agentId: string | null;
    encValue: string;
    iv: string;
    tag: string;
}>;
/**
 * Resolve ${secret:KEY} references in a config string.
 * Used by heartbeat-executor to inject secrets into adapterConfig at runtime.
 */
export declare function resolveSecretRefs(config: string, workspaceId: string): Promise<string>;
//# sourceMappingURL=agent-secrets.d.ts.map