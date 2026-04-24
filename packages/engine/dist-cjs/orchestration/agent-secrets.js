"use strict";
/**
 * Agent Secrets — encrypted key-value storage for sensitive agent configuration.
 *
 * Uses AES-256-GCM with a workspace-derived key.
 * Secrets can be referenced in adapterConfig as ${secret:KEY_NAME}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSecret = setSecret;
exports.getSecret = getSecret;
exports.listSecrets = listSecrets;
exports.deleteSecret = deleteSecret;
exports.resolveSecretRefs = resolveSecretRefs;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
const ALGORITHM = "aes-256-gcm";
/**
 * Derive a 256-bit key from workspace ID + master secret.
 * Master secret comes from AGENT_SECRETS_MASTER_KEY env var.
 */
function deriveKey(workspaceId) {
    const master = process.env.AGENT_SECRETS_MASTER_KEY ?? "ceoclaw-dev-secret-key-change-in-prod";
    return (0, node_crypto_1.createHash)("sha256").update(`${master}:${workspaceId}`).digest();
}
function encrypt(plaintext, workspaceId) {
    const key = deriveKey(workspaceId);
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)(ALGORITHM, key, iv);
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
    const decipher = (0, node_crypto_1.createDecipheriv)(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encValue, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
// ── CRUD ──
async function setSecret(workspaceId, key, value, agentId) {
    const { encValue, iv, tag } = encrypt(value, workspaceId);
    return prisma_1.prisma.agentSecret.upsert({
        where: { workspaceId_key: { workspaceId, key } },
        create: { workspaceId, agentId: agentId ?? null, key, encValue, iv, tag },
        update: { encValue, iv, tag, agentId: agentId ?? undefined },
    });
}
async function getSecret(workspaceId, key) {
    const secret = await prisma_1.prisma.agentSecret.findUnique({
        where: { workspaceId_key: { workspaceId, key } },
    });
    if (!secret)
        return null;
    return decrypt(secret.encValue, secret.iv, secret.tag, workspaceId);
}
async function listSecrets(workspaceId, agentId) {
    const where = { workspaceId };
    if (agentId)
        where.agentId = agentId;
    const secrets = await prisma_1.prisma.agentSecret.findMany({
        where,
        select: { id: true, key: true, agentId: true, createdAt: true, updatedAt: true },
        orderBy: { key: "asc" },
    });
    return secrets;
}
async function deleteSecret(workspaceId, key) {
    return prisma_1.prisma.agentSecret.delete({
        where: { workspaceId_key: { workspaceId, key } },
    });
}
/**
 * Resolve ${secret:KEY} references in a config string.
 * Used by heartbeat-executor to inject secrets into adapterConfig at runtime.
 */
async function resolveSecretRefs(config, workspaceId) {
    const pattern = /\$\{secret:([A-Za-z0-9_-]+)\}/g;
    const matches = [...config.matchAll(pattern)];
    if (matches.length === 0)
        return config;
    let resolved = config;
    for (const match of matches) {
        const key = match[1];
        const value = await getSecret(workspaceId, key);
        if (value !== null) {
            resolved = resolved.replace(match[0], value);
        }
    }
    return resolved;
}
