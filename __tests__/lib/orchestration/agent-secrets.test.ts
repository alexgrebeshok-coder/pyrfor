import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredSecret = {
  id: string;
  workspaceId: string;
  key: string;
  agentId: string | null;
  encValue: string;
  iv: string;
  tag: string;
  createdAt: Date;
  updatedAt: Date;
};

const mocks = vi.hoisted(() => {
  const store = new Map<string, StoredSecret>();

  const prisma = {
    agentSecret: {
      upsert: vi.fn(({ where, create, update }: { where: { workspaceId_key: { workspaceId: string; key: string } }; create: Omit<StoredSecret, "id" | "createdAt" | "updatedAt">; update: Partial<Omit<StoredSecret, "id" | "createdAt" | "updatedAt">> }) => {
        const mapKey = `${where.workspaceId_key.workspaceId}:${where.workspaceId_key.key}`;
        const previous = store.get(mapKey);
        const record: StoredSecret = {
          id: previous?.id ?? `secret-${store.size + 1}`,
          workspaceId: create.workspaceId,
          key: create.key,
          agentId: update.agentId ?? create.agentId,
          encValue: update.encValue ?? create.encValue,
          iv: update.iv ?? create.iv,
          tag: update.tag ?? create.tag,
          createdAt: previous?.createdAt ?? new Date("2026-04-16T00:00:00.000Z"),
          updatedAt: new Date("2026-04-16T00:00:00.000Z"),
        };
        store.set(mapKey, record);
        return Promise.resolve(record);
      }),
      findUnique: vi.fn(({ where }: { where: { workspaceId_key: { workspaceId: string; key: string } } }) =>
        Promise.resolve(
          store.get(`${where.workspaceId_key.workspaceId}:${where.workspaceId_key.key}`) ?? null
        )
      ),
      findMany: vi.fn(({ where }: { where: { workspaceId: string; agentId?: string } }) =>
        Promise.resolve(
          [...store.values()]
            .filter(
              (secret) =>
                secret.workspaceId === where.workspaceId &&
                (where.agentId === undefined || secret.agentId === where.agentId)
            )
            .map(({ id, key, agentId, createdAt, updatedAt }) => ({
              id,
              key,
              agentId,
              createdAt,
              updatedAt,
            }))
        )
      ),
      delete: vi.fn(({ where }: { where: { workspaceId_key: { workspaceId: string; key: string } } }) => {
        store.delete(`${where.workspaceId_key.workspaceId}:${where.workspaceId_key.key}`);
        return Promise.resolve({ id: "deleted" });
      }),
    },
  };

  return {
    store,
    prisma,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  deleteSecret,
  getSecret,
  listSecrets,
  resolveSecretRefs,
  setSecret,
} from "@/lib/orchestration/agent-secrets";

describe("agent secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.clear();
    process.env.AGENT_SECRETS_MASTER_KEY = "test-master-key";
  });

  it("encrypts persisted values and decrypts them on read", async () => {
    const saved = await setSecret("workspace-1", "API_TOKEN", "super-secret", "agent-1");

    expect(saved.encValue).not.toBe("super-secret");
    expect(saved.iv).toMatch(/^[a-f0-9]+$/);
    expect(saved.tag).toMatch(/^[a-f0-9]+$/);

    await expect(getSecret("workspace-1", "API_TOKEN")).resolves.toBe("super-secret");
  });

  it("resolves secret placeholders and keeps unknown placeholders intact", async () => {
    await setSecret("workspace-1", "API_TOKEN", "token-123");
    await setSecret("workspace-1", "CHAT_ID", "chat-999");

    const resolved = await resolveSecretRefs(
      '{"token":"${secret:API_TOKEN}","chat":"${secret:CHAT_ID}","missing":"${secret:MISSING}"}',
      "workspace-1"
    );

    expect(resolved).toContain('"token":"token-123"');
    expect(resolved).toContain('"chat":"chat-999"');
    expect(resolved).toContain('"missing":"${secret:MISSING}"');
  });

  it("lists only metadata and supports deletion", async () => {
    await setSecret("workspace-1", "API_TOKEN", "super-secret", "agent-1");

    await expect(listSecrets("workspace-1", "agent-1")).resolves.toEqual([
      expect.objectContaining({
        key: "API_TOKEN",
        agentId: "agent-1",
      }),
    ]);

    await deleteSecret("workspace-1", "API_TOKEN");
    await expect(getSecret("workspace-1", "API_TOKEN")).resolves.toBeNull();
  });
});
