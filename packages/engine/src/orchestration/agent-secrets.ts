/**
 * Agent Secrets — encrypted key-value storage for sensitive agent configuration.
 *
 * Uses AES-256-GCM with a workspace-derived key.
 * Secrets can be referenced in adapterConfig as ${secret:KEY_NAME}.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

import { prisma } from '../prisma';

const ALGORITHM = "aes-256-gcm";

/**
 * Derive a 256-bit key from workspace ID + master secret.
 * Master secret comes from AGENT_SECRETS_MASTER_KEY env var.
 */
function deriveKey(workspaceId: string): Buffer {
  const master = process.env.AGENT_SECRETS_MASTER_KEY ?? "ceoclaw-dev-secret-key-change-in-prod";
  return createHash("sha256").update(`${master}:${workspaceId}`).digest();
}

function encrypt(plaintext: string, workspaceId: string): { encValue: string; iv: string; tag: string } {
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

function decrypt(encValue: string, ivHex: string, tagHex: string, workspaceId: string): string {
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

export async function setSecret(workspaceId: string, key: string, value: string, agentId?: string) {
  const { encValue, iv, tag } = encrypt(value, workspaceId);

  return prisma.agentSecret.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: { workspaceId, agentId: agentId ?? null, key, encValue, iv, tag },
    update: { encValue, iv, tag, agentId: agentId ?? undefined },
  });
}

export async function getSecret(workspaceId: string, key: string): Promise<string | null> {
  const secret = await prisma.agentSecret.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  });
  if (!secret) return null;
  return decrypt(secret.encValue, secret.iv, secret.tag, workspaceId);
}

export async function listSecrets(workspaceId: string, agentId?: string) {
  const where: Record<string, unknown> = { workspaceId };
  if (agentId) where.agentId = agentId;

  const secrets = await prisma.agentSecret.findMany({
    where,
    select: { id: true, key: true, agentId: true, createdAt: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  return secrets;
}

export async function deleteSecret(workspaceId: string, key: string) {
  return prisma.agentSecret.delete({
    where: { workspaceId_key: { workspaceId, key } },
  });
}

/**
 * Resolve ${secret:KEY} references in a config string.
 * Used by heartbeat-executor to inject secrets into adapterConfig at runtime.
 */
export async function resolveSecretRefs(config: string, workspaceId: string): Promise<string> {
  const pattern = /\$\{secret:([A-Za-z0-9_-]+)\}/g;
  const matches = [...config.matchAll(pattern)];
  if (matches.length === 0) return config;

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
