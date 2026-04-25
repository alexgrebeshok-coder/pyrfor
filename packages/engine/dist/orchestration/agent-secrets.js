/**
 * Agent Secrets — encrypted key-value storage for sensitive agent configuration.
 *
 * Uses AES-256-GCM with a workspace-derived key.
 * Secrets can be referenced in adapterConfig as ${secret:KEY_NAME}.
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
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { prisma } from '../prisma.js';
const ALGORITHM = "aes-256-gcm";
/**
 * Derive a 256-bit key from workspace ID + master secret.
 * Master secret comes from AGENT_SECRETS_MASTER_KEY env var.
 */
function deriveKey(workspaceId) {
    var _a;
    const master = (_a = process.env.AGENT_SECRETS_MASTER_KEY) !== null && _a !== void 0 ? _a : "ceoclaw-dev-secret-key-change-in-prod";
    return createHash("sha256").update(`${master}:${workspaceId}`).digest();
}
function encrypt(plaintext, workspaceId) {
    const key = deriveKey(workspaceId);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return {
        encValue: encrypted,
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
    };
}
function decrypt(encValue, ivHex, tagHex, workspaceId) {
    const key = deriveKey(workspaceId);
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encValue, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
// ── CRUD ──
export function setSecret(workspaceId, key, value, agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { encValue, iv, tag } = encrypt(value, workspaceId);
        return prisma.agentSecret.upsert({
            where: { workspaceId_key: { workspaceId, key } },
            create: { workspaceId, agentId: agentId !== null && agentId !== void 0 ? agentId : null, key, encValue, iv, tag },
            update: { encValue, iv, tag, agentId: agentId !== null && agentId !== void 0 ? agentId : undefined },
        });
    });
}
export function getSecret(workspaceId, key) {
    return __awaiter(this, void 0, void 0, function* () {
        const secret = yield prisma.agentSecret.findUnique({
            where: { workspaceId_key: { workspaceId, key } },
        });
        if (!secret)
            return null;
        return decrypt(secret.encValue, secret.iv, secret.tag, workspaceId);
    });
}
export function listSecrets(workspaceId, agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const where = { workspaceId };
        if (agentId)
            where.agentId = agentId;
        const secrets = yield prisma.agentSecret.findMany({
            where,
            select: { id: true, key: true, agentId: true, createdAt: true, updatedAt: true },
            orderBy: { key: "asc" },
        });
        return secrets;
    });
}
export function deleteSecret(workspaceId, key) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.agentSecret.delete({
            where: { workspaceId_key: { workspaceId, key } },
        });
    });
}
/**
 * Resolve ${secret:KEY} references in a config string.
 * Used by heartbeat-executor to inject secrets into adapterConfig at runtime.
 */
export function resolveSecretRefs(config, workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        const pattern = /\$\{secret:([A-Za-z0-9_-]+)\}/g;
        const matches = [...config.matchAll(pattern)];
        if (matches.length === 0)
            return config;
        let resolved = config;
        for (const match of matches) {
            const key = match[1];
            const value = yield getSecret(workspaceId, key);
            if (value !== null) {
                resolved = resolved.replace(match[0], value);
            }
        }
        return resolved;
    });
}
