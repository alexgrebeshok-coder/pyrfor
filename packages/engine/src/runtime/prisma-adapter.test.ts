import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNoopPrismaClient,
  tryLoadPrismaClient,
  installPrismaClient,
} from './prisma-adapter';
import { getCronPrismaClient, setCronPrismaClient } from './cron/handlers';
import { getTelegramPrismaClient, setTelegramPrismaClient } from './telegram/handlers';

// Reset injected clients before each test so tests are isolated.
beforeEach(() => {
  // Reset to null via the public setters so we start clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCronPrismaClient(null as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTelegramPrismaClient(null as any);
});

// ─── createNoopPrismaClient ───────────────────────────────────────────────────

describe('createNoopPrismaClient', () => {
  it('project.findMany returns empty array', async () => {
    const client = createNoopPrismaClient();
    await expect(client.project.findMany()).resolves.toEqual([]);
  });

  it('project.findFirst returns null', async () => {
    const client = createNoopPrismaClient();
    await expect(client.project.findFirst()).resolves.toBeNull();
  });

  it('project.count returns 0', async () => {
    const client = createNoopPrismaClient();
    await expect(client.project.count()).resolves.toBe(0);
  });

  it('task.findMany returns empty array', async () => {
    const client = createNoopPrismaClient();
    await expect(client.task.findMany()).resolves.toEqual([]);
  });

  it('task.count returns 0', async () => {
    const client = createNoopPrismaClient();
    await expect(client.task.count()).resolves.toBe(0);
  });

  it('task.create throws with "noop" message', async () => {
    const client = createNoopPrismaClient();
    await expect(client.task.create({ data: {} })).rejects.toThrow('noop');
  });

  it('risk.count returns 0', async () => {
    const client = createNoopPrismaClient();
    await expect(client.risk.count()).resolves.toBe(0);
  });

  it('memory.deleteMany returns { count: 0 }', async () => {
    const client = createNoopPrismaClient();
    await expect(client.memory.deleteMany()).resolves.toEqual({ count: 0 });
  });

  it('memory.count returns 0', async () => {
    const client = createNoopPrismaClient();
    await expect(client.memory.count()).resolves.toBe(0);
  });

  it('agent.updateMany returns { count: 0 }', async () => {
    const client = createNoopPrismaClient();
    await expect(client.agent.updateMany()).resolves.toEqual({ count: 0 });
  });

  it('$queryRaw returns empty array', async () => {
    const client = createNoopPrismaClient();
    const result = await client.$queryRaw`SELECT 1`;
    expect(result).toEqual([]);
  });
});

// ─── tryLoadPrismaClient ──────────────────────────────────────────────────────

describe('tryLoadPrismaClient', () => {
  it('returns null when the loader throws (simulates missing @prisma/client)', async () => {
    const result = await tryLoadPrismaClient(() =>
      Promise.reject(new Error('Cannot find module @prisma/client')),
    );
    expect(result).toBeNull();
  });

  it('returns null when the loader resolves with no PrismaClient export', async () => {
    const result = await tryLoadPrismaClient(() => Promise.resolve({}));
    expect(result).toBeNull();
  });

  it('returns a PrismaLike when the loader provides a usable PrismaClient', async () => {
    const FakePrisma = class {};
    const result = await tryLoadPrismaClient(() =>
      Promise.resolve({ PrismaClient: FakePrisma }),
    );
    expect(result).toBeInstanceOf(FakePrisma);
  });
});

// ─── installPrismaClient ──────────────────────────────────────────────────────

describe('installPrismaClient', () => {
  it('installs the client into both cron and telegram handlers', () => {
    const client = createNoopPrismaClient();
    installPrismaClient(client);

    expect(getCronPrismaClient()).toBe(client);
    // getTelegramPrismaClient throws when null, so we check via getCronPrismaClient pattern.
    // For telegram, call setTelegramPrismaClient directly; we verify it equals our client.
    // We verify indirectly by calling installPrismaClient and re-reading via the public getter
    // defined in telegram/handlers.ts. Note: getTelegramPrismaClient throws if null —
    // reaching this line without throwing confirms it was set.
    // We need to access it without throwing; re-set it to our client and read it back.
    const telegramClient = getTelegramPrismaClientSafe();
    expect(telegramClient).toBe(client);
  });

  it('cron and telegram handlers share the exact same client reference', () => {
    const client = createNoopPrismaClient();
    installPrismaClient(client);

    expect(getCronPrismaClient()).toBe(getTelegramPrismaClient());
  });

  it('second installPrismaClient call replaces both handlers with the new client', () => {
    const client1 = createNoopPrismaClient();
    const client2 = createNoopPrismaClient();

    installPrismaClient(client1);
    installPrismaClient(client2);

    expect(getCronPrismaClient()).toBe(client2);
    expect(getTelegramPrismaClient()).toBe(client2);
  });

  it('last of N sequential installs wins — deterministic outcome', () => {
    const clients = [createNoopPrismaClient(), createNoopPrismaClient(), createNoopPrismaClient()];
    for (const c of clients) installPrismaClient(c);

    const last = clients[clients.length - 1];
    expect(getCronPrismaClient()).toBe(last);
    expect(getTelegramPrismaClient()).toBe(last);
  });

  it('passing null clears the cron client (getCronPrismaClient returns null)', () => {
    installPrismaClient(createNoopPrismaClient());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    installPrismaClient(null as any);

    expect(getCronPrismaClient()).toBeNull();
  });

  it('passing null makes getTelegramPrismaClient throw', () => {
    installPrismaClient(createNoopPrismaClient());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    installPrismaClient(null as any);

    expect(() => getTelegramPrismaClient()).toThrow('Prisma client not initialised');
  });
});

// ─── Pre-install getter behaviour ────────────────────────────────────────────

describe('getCronPrismaClient before install', () => {
  it('returns null when no client has been installed (no throw)', () => {
    // beforeEach resets both to null
    expect(getCronPrismaClient()).toBeNull();
  });
});

describe('getTelegramPrismaClient before install', () => {
  it('throws with a clear message when no client has been installed', () => {
    expect(() => getTelegramPrismaClient()).toThrow('[tg-handlers] Prisma client not initialised');
  });
});

// ─── tryLoadPrismaClient — additional loader shapes ───────────────────────────

describe('tryLoadPrismaClient — additional loader shapes', () => {
  it('returns instance when PrismaClient is nested under default.PrismaClient', async () => {
    const FakePrisma = class {};
    const result = await tryLoadPrismaClient(() =>
      Promise.resolve({ default: { PrismaClient: FakePrisma } }),
    );
    expect(result).toBeInstanceOf(FakePrisma);
  });
});

// Helper: getTelegramPrismaClient but without the throw guard.
// We re-install the client and read it back using the module's own getter,
// relying on the fact that installPrismaClient set it above.
function getTelegramPrismaClientSafe() {
  // After installPrismaClient the telegram handler has the client set;
  // getTelegramPrismaClient() won't throw. Call it directly.
  return getTelegramPrismaClient();
}
