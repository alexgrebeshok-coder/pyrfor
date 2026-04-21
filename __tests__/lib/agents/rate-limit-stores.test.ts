import { describe, expect, it, vi } from "vitest";

import {
  createIoredisRateLimitStore,
  createRateLimitStoreFromEnv,
  createUpstashRateLimitStore,
} from "@/lib/agents/rate-limit-stores";

describe("createUpstashRateLimitStore", () => {
  it("pipelines INCR+PEXPIRE+PTTL against the Upstash REST endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [
        { result: 5 },
        { result: 1 },
        { result: 30_000 },
      ],
    } as Response);

    const store = createUpstashRateLimitStore({
      url: "https://fake-upstash.io/",
      token: "tok-123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await store.incrementWindow("ceoclaw:rl:openai", 60_000);
    expect(result).toEqual({ count: 5, ttlMs: 30_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://fake-upstash.io/pipeline");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer tok-123",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(init?.body ?? "[]")) as unknown[];
    expect(body).toEqual([
      ["INCR", "ceoclaw:rl:openai"],
      ["PEXPIRE", "ceoclaw:rl:openai", "60000", "NX"],
      ["PTTL", "ceoclaw:rl:openai"],
    ]);
  });

  it("falls back to windowMs when PTTL returns -1 or -2", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [{ result: 1 }, { result: 1 }, { result: -1 }],
    } as Response);

    const store = createUpstashRateLimitStore({
      url: "https://u.io",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await store.incrementWindow("k", 5_000);
    expect(result).toEqual({ count: 1, ttlMs: 5_000 });
  });

  it("throws when Upstash returns a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Error",
      json: async () => [],
    } as Response);

    const store = createUpstashRateLimitStore({
      url: "https://u.io",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(store.incrementWindow("k", 1_000)).rejects.toThrow(
      /500 Internal Error/
    );
  });

  it("tolerates bare-number pipeline entries (older upstash accounts)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [7, 1, 2_000],
    } as Response);

    const store = createUpstashRateLimitStore({
      url: "https://u.io",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await store.incrementWindow("k", 10_000);
    expect(result).toEqual({ count: 7, ttlMs: 2_000 });
  });
});

describe("createIoredisRateLimitStore", () => {
  it("issues a MULTI pipeline and parses its results", async () => {
    const incr = vi.fn().mockReturnThis();
    const pexpire = vi.fn().mockReturnThis();
    const pttl = vi.fn().mockReturnThis();
    const exec = vi.fn().mockResolvedValue([
      [null, 4],
      [null, 1],
      [null, 12_000],
    ]);
    const client = { multi: () => ({ incr, pexpire, pttl, exec }) };

    const store = createIoredisRateLimitStore(client);
    const result = await store.incrementWindow("k", 60_000);

    expect(result).toEqual({ count: 4, ttlMs: 12_000 });
    expect(incr).toHaveBeenCalledWith("k");
    expect(pexpire).toHaveBeenCalledWith("k", 60_000, "NX");
    expect(pttl).toHaveBeenCalledWith("k");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("throws when MULTI fails", async () => {
    const failing = {
      multi: () => ({
        incr: () => failing.multi() as never,
        pexpire: () => failing.multi() as never,
        pttl: () => failing.multi() as never,
        exec: () => Promise.resolve(null),
      }),
    } as unknown as Parameters<typeof createIoredisRateLimitStore>[0];
    const store = createIoredisRateLimitStore(failing);
    await expect(store.incrementWindow("k", 1_000)).rejects.toThrow(
      /pipeline returned no results/
    );
  });

  it("propagates INCR errors", async () => {
    const err = new Error("oom");
    const client = {
      multi: () => ({
        incr: () => client.multi() as never,
        pexpire: () => client.multi() as never,
        pttl: () => client.multi() as never,
        exec: async () => [
          [err, null],
          [null, 1],
          [null, 1000],
        ],
      }),
    } as unknown as Parameters<typeof createIoredisRateLimitStore>[0];
    const store = createIoredisRateLimitStore(client);
    await expect(store.incrementWindow("k", 1000)).rejects.toBe(err);
  });
});

describe("createRateLimitStoreFromEnv", () => {
  it("returns null when either env var is missing", () => {
    expect(createRateLimitStoreFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      createRateLimitStoreFromEnv({
        UPSTASH_REDIS_REST_URL: "https://x",
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(
      createRateLimitStoreFromEnv({
        UPSTASH_REDIS_REST_TOKEN: "t",
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
  });

  it("returns a functional Upstash store when both env vars are set", () => {
    const store = createRateLimitStoreFromEnv({
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as unknown as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(typeof store?.incrementWindow).toBe("function");
  });
});
