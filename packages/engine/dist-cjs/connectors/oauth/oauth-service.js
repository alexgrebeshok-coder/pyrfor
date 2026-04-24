"use strict";
/**
 * OAuth service — handles token exchange, refresh, storage
 * Workspace-scoped: each workspace has its own connector credentials
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOAuthAuthorizeUrl = getOAuthAuthorizeUrl;
exports.exchangeCodeForTokens = exchangeCodeForTokens;
exports.refreshAccessToken = refreshAccessToken;
exports.getValidAccessToken = getValidAccessToken;
exports.getActiveCredential = getActiveCredential;
exports.saveCredential = saveCredential;
exports.revokeCredential = revokeCredential;
exports.listWorkspaceCredentials = listWorkspaceCredentials;
exports.logSyncEntry = logSyncEntry;
const db_1 = require("../../db");
const providers_1 = require("./providers");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// ─── URL builders ──────────────────────────────────────────────────────
function getOAuthAuthorizeUrl(provider, connectorId, workspaceId, extraScopes) {
    const cfg = providers_1.OAUTH_PROVIDERS[provider];
    if (!cfg)
        throw new Error(`Unknown OAuth provider: ${provider}`);
    const clientId = process.env[cfg.clientIdEnv];
    if (!clientId)
        throw new Error(`Missing env ${cfg.clientIdEnv} for provider ${provider}`);
    const scopes = [
        ...cfg.defaultScopes,
        ...(extraScopes ?? []),
    ];
    const state = Buffer.from(JSON.stringify({ provider, connectorId, workspaceId })).toString("base64url");
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${APP_URL}/api/connectors/oauth/callback`,
        response_type: "code",
        scope: scopes.join(" "),
        state,
        ...(cfg.authParams ?? {}),
    });
    return `${cfg.authUrl}?${params.toString()}`;
}
async function exchangeCodeForTokens(provider, code) {
    const cfg = providers_1.OAUTH_PROVIDERS[provider];
    if (!cfg)
        throw new Error(`Unknown OAuth provider: ${provider}`);
    const clientId = process.env[cfg.clientIdEnv];
    const clientSecret = process.env[cfg.clientSecretEnv];
    if (!clientId || !clientSecret)
        throw new Error(`Missing env ${cfg.clientIdEnv}/${cfg.clientSecretEnv}`);
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${APP_URL}/api/connectors/oauth/callback`,
        client_id: clientId,
        client_secret: clientSecret,
    });
    const res = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json();
}
// ─── Token refresh ─────────────────────────────────────────────────────
async function refreshAccessToken(credentialId) {
    const cred = await db_1.prisma.connectorCredential.findUnique({
        where: { id: credentialId },
    });
    if (!cred)
        throw new Error(`Credential ${credentialId} not found`);
    if (!cred.refreshToken)
        throw new Error(`No refresh token for credential ${credentialId}`);
    const cfg = providers_1.OAUTH_PROVIDERS[cred.provider];
    if (!cfg)
        throw new Error(`Unknown provider: ${cred.provider}`);
    const clientId = process.env[cfg.clientIdEnv];
    const clientSecret = process.env[cfg.clientSecretEnv];
    if (!clientId || !clientSecret)
        throw new Error(`Missing env for provider ${cred.provider}`);
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
    });
    const res = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        // Mark credential as inactive if refresh fails permanently
        if (res.status === 400 || res.status === 401) {
            await db_1.prisma.connectorCredential.update({
                where: { id: credentialId },
                data: { isActive: false },
            });
        }
        throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const tokens = (await res.json());
    const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;
    await db_1.prisma.connectorCredential.update({
        where: { id: credentialId },
        data: {
            accessToken: tokens.access_token,
            ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
            tokenExpiresAt: expiresAt,
        },
    });
    return tokens.access_token;
}
// ─── Credential helpers ────────────────────────────────────────────────
/**
 * Get a valid access token — refreshes if expired
 */
async function getValidAccessToken(credentialId) {
    const cred = await db_1.prisma.connectorCredential.findUnique({
        where: { id: credentialId },
    });
    if (!cred)
        throw new Error(`Credential ${credentialId} not found`);
    if (!cred.isActive)
        throw new Error(`Credential ${credentialId} is inactive`);
    // If token not expired yet (with 5 min buffer), return it
    if (cred.tokenExpiresAt &&
        cred.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
        return cred.accessToken;
    }
    // Refresh needed
    return refreshAccessToken(credentialId);
}
/**
 * Get active credential for a connector in a workspace
 */
async function getActiveCredential(workspaceId, connectorId) {
    return db_1.prisma.connectorCredential.findFirst({
        where: { workspaceId, connectorId, isActive: true },
    });
}
/**
 * Save tokens after initial OAuth callback
 */
async function saveCredential(opts) {
    const expiresAt = opts.expiresIn
        ? new Date(Date.now() + opts.expiresIn * 1000)
        : null;
    return db_1.prisma.connectorCredential.upsert({
        where: {
            workspaceId_connectorId: {
                workspaceId: opts.workspaceId,
                connectorId: opts.connectorId,
            },
        },
        update: {
            accessToken: opts.accessToken,
            refreshToken: opts.refreshToken ?? undefined,
            tokenExpiresAt: expiresAt,
            scopes: opts.scopes,
            accountEmail: opts.accountEmail,
            accountLabel: opts.accountLabel,
            metadata: opts.metadata,
            isActive: true,
        },
        create: {
            workspaceId: opts.workspaceId,
            connectorId: opts.connectorId,
            provider: opts.provider,
            accessToken: opts.accessToken,
            refreshToken: opts.refreshToken,
            tokenExpiresAt: expiresAt,
            scopes: opts.scopes,
            accountEmail: opts.accountEmail,
            accountLabel: opts.accountLabel,
            metadata: opts.metadata,
        },
    });
}
/**
 * Revoke a credential — mark inactive
 */
async function revokeCredential(credentialId) {
    return db_1.prisma.connectorCredential.update({
        where: { id: credentialId },
        data: {
            isActive: false,
            accessToken: "REVOKED",
            refreshToken: null,
        },
    });
}
/**
 * List all credentials for a workspace
 */
async function listWorkspaceCredentials(workspaceId) {
    return db_1.prisma.connectorCredential.findMany({
        where: { workspaceId },
        select: {
            id: true,
            connectorId: true,
            provider: true,
            accountLabel: true,
            accountEmail: true,
            isActive: true,
            tokenExpiresAt: true,
            scopes: true,
            createdAt: true,
            updatedAt: true,
            syncEntries: {
                orderBy: { startedAt: "desc" },
                take: 1,
                select: {
                    status: true,
                    recordsProcessed: true,
                    recordsFailed: true,
                    startedAt: true,
                    completedAt: true,
                    error: true,
                },
            },
        },
        orderBy: { connectorId: "asc" },
    });
}
/**
 * Log a sync entry for a credential
 */
async function logSyncEntry(opts) {
    return db_1.prisma.connectorSyncEntry.create({
        data: {
            credentialId: opts.credentialId,
            direction: opts.direction,
            entityType: opts.entityType,
            status: opts.status,
            recordsProcessed: opts.recordsProcessed ?? 0,
            recordsFailed: opts.recordsFailed ?? 0,
            error: opts.error,
            syncToken: opts.syncToken,
            completedAt: opts.status === "completed" || opts.status === "failed"
                ? new Date()
                : undefined,
        },
    });
}
