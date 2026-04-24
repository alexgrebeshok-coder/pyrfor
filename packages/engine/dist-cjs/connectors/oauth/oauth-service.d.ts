/**
 * OAuth service — handles token exchange, refresh, storage
 * Workspace-scoped: each workspace has its own connector credentials
 */
import { type OAuthProviderName } from "./providers";
export declare function getOAuthAuthorizeUrl(provider: OAuthProviderName, connectorId: string, workspaceId: string, extraScopes?: string[]): string;
interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
}
export declare function exchangeCodeForTokens(provider: OAuthProviderName, code: string): Promise<TokenResponse>;
export declare function refreshAccessToken(credentialId: string): Promise<string>;
/**
 * Get a valid access token — refreshes if expired
 */
export declare function getValidAccessToken(credentialId: string): Promise<string>;
/**
 * Get active credential for a connector in a workspace
 */
export declare function getActiveCredential(workspaceId: string, connectorId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    provider: string;
    workspaceId: string;
    metadata: string | null;
    connectorId: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    accountLabel: string | null;
    accountEmail: string | null;
    isActive: boolean;
} | null>;
/**
 * Save tokens after initial OAuth callback
 */
export declare function saveCredential(opts: {
    workspaceId: string;
    connectorId: string;
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    scopes?: string;
    accountEmail?: string;
    accountLabel?: string;
    metadata?: string;
}): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    provider: string;
    workspaceId: string;
    metadata: string | null;
    connectorId: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    accountLabel: string | null;
    accountEmail: string | null;
    isActive: boolean;
}>;
/**
 * Revoke a credential — mark inactive
 */
export declare function revokeCredential(credentialId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    provider: string;
    workspaceId: string;
    metadata: string | null;
    connectorId: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    accountLabel: string | null;
    accountEmail: string | null;
    isActive: boolean;
}>;
/**
 * List all credentials for a workspace
 */
export declare function listWorkspaceCredentials(workspaceId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    provider: string;
    connectorId: string;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    accountLabel: string | null;
    accountEmail: string | null;
    isActive: boolean;
    syncEntries: {
        error: string | null;
        status: string;
        completedAt: Date | null;
        startedAt: Date;
        recordsProcessed: number;
        recordsFailed: number;
    }[];
}[]>;
/**
 * Log a sync entry for a credential
 */
export declare function logSyncEntry(opts: {
    credentialId: string;
    direction: "pull" | "push";
    entityType: string;
    status: "running" | "completed" | "failed";
    recordsProcessed?: number;
    recordsFailed?: number;
    error?: string;
    syncToken?: string;
}): Promise<{
    error: string | null;
    id: string;
    direction: string;
    status: string;
    completedAt: Date | null;
    startedAt: Date;
    entityType: string;
    credentialId: string;
    recordsProcessed: number;
    recordsFailed: number;
    syncToken: string | null;
}>;
export {};
//# sourceMappingURL=oauth-service.d.ts.map