/**
 * OAuth service — handles token exchange, refresh, storage
 * Workspace-scoped: each workspace has its own connector credentials
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../../db.js';
import { OAUTH_PROVIDERS, } from "./providers.js";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// ─── URL builders ──────────────────────────────────────────────────────
export function getOAuthAuthorizeUrl(provider, connectorId, workspaceId, extraScopes) {
    var _a;
    const cfg = OAUTH_PROVIDERS[provider];
    if (!cfg)
        throw new Error(`Unknown OAuth provider: ${provider}`);
    const clientId = process.env[cfg.clientIdEnv];
    if (!clientId)
        throw new Error(`Missing env ${cfg.clientIdEnv} for provider ${provider}`);
    const scopes = [
        ...cfg.defaultScopes,
        ...(extraScopes !== null && extraScopes !== void 0 ? extraScopes : []),
    ];
    const state = Buffer.from(JSON.stringify({ provider, connectorId, workspaceId })).toString("base64url");
    const params = new URLSearchParams(Object.assign({ client_id: clientId, redirect_uri: `${APP_URL}/api/connectors/oauth/callback`, response_type: "code", scope: scopes.join(" "), state }, ((_a = cfg.authParams) !== null && _a !== void 0 ? _a : {})));
    return `${cfg.authUrl}?${params.toString()}`;
}
export function exchangeCodeForTokens(provider, code) {
    return __awaiter(this, void 0, void 0, function* () {
        const cfg = OAUTH_PROVIDERS[provider];
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
        const res = yield fetch(cfg.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = yield res.text();
            throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return res.json();
    });
}
// ─── Token refresh ─────────────────────────────────────────────────────
export function refreshAccessToken(credentialId) {
    return __awaiter(this, void 0, void 0, function* () {
        const cred = yield prisma.connectorCredential.findUnique({
            where: { id: credentialId },
        });
        if (!cred)
            throw new Error(`Credential ${credentialId} not found`);
        if (!cred.refreshToken)
            throw new Error(`No refresh token for credential ${credentialId}`);
        const cfg = OAUTH_PROVIDERS[cred.provider];
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
        const res = yield fetch(cfg.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        if (!res.ok) {
            const text = yield res.text();
            // Mark credential as inactive if refresh fails permanently
            if (res.status === 400 || res.status === 401) {
                yield prisma.connectorCredential.update({
                    where: { id: credentialId },
                    data: { isActive: false },
                });
            }
            throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 200)}`);
        }
        const tokens = (yield res.json());
        const expiresAt = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null;
        yield prisma.connectorCredential.update({
            where: { id: credentialId },
            data: Object.assign(Object.assign({ accessToken: tokens.access_token }, (tokens.refresh_token && { refreshToken: tokens.refresh_token })), { tokenExpiresAt: expiresAt }),
        });
        return tokens.access_token;
    });
}
// ─── Credential helpers ────────────────────────────────────────────────
/**
 * Get a valid access token — refreshes if expired
 */
export function getValidAccessToken(credentialId) {
    return __awaiter(this, void 0, void 0, function* () {
        const cred = yield prisma.connectorCredential.findUnique({
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
    });
}
/**
 * Get active credential for a connector in a workspace
 */
export function getActiveCredential(workspaceId, connectorId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.connectorCredential.findFirst({
            where: { workspaceId, connectorId, isActive: true },
        });
    });
}
/**
 * Save tokens after initial OAuth callback
 */
export function saveCredential(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const expiresAt = opts.expiresIn
            ? new Date(Date.now() + opts.expiresIn * 1000)
            : null;
        return prisma.connectorCredential.upsert({
            where: {
                workspaceId_connectorId: {
                    workspaceId: opts.workspaceId,
                    connectorId: opts.connectorId,
                },
            },
            update: {
                accessToken: opts.accessToken,
                refreshToken: (_a = opts.refreshToken) !== null && _a !== void 0 ? _a : undefined,
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
    });
}
/**
 * Revoke a credential — mark inactive
 */
export function revokeCredential(credentialId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.connectorCredential.update({
            where: { id: credentialId },
            data: {
                isActive: false,
                accessToken: "REVOKED",
                refreshToken: null,
            },
        });
    });
}
/**
 * List all credentials for a workspace
 */
export function listWorkspaceCredentials(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.connectorCredential.findMany({
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
    });
}
/**
 * Log a sync entry for a credential
 */
export function logSyncEntry(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        return prisma.connectorSyncEntry.create({
            data: {
                credentialId: opts.credentialId,
                direction: opts.direction,
                entityType: opts.entityType,
                status: opts.status,
                recordsProcessed: (_a = opts.recordsProcessed) !== null && _a !== void 0 ? _a : 0,
                recordsFailed: (_b = opts.recordsFailed) !== null && _b !== void 0 ? _b : 0,
                error: opts.error,
                syncToken: opts.syncToken,
                completedAt: opts.status === "completed" || opts.status === "failed"
                    ? new Date()
                    : undefined,
            },
        });
    });
}
