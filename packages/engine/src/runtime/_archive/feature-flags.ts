/**
 * feature-flags.ts — Runtime feature flags with rollout %, user targeting, and A/B variants.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Flag {
  key: string;
  enabled: boolean;
  rollout?: number;                                                         // 0-100 percent
  userIds?: string[];                                                       // explicit allowlist (always on)
  blockedUserIds?: string[];                                                // always off
  variants?: { name: string; weight: number }[];                           // A/B distribution
  rules?: Array<{ field: string; op: 'eq' | 'neq' | 'in' | 'gt' | 'lt'; value: unknown }>;
  expiresAt?: number;                                                       // ms epoch
  metadata?: Record<string, unknown>;
}

export interface EvalContext {
  userId?: string;
  [k: string]: unknown;
}

export interface EvalResult {
  enabled: boolean;
  variant?: string;
  reason: string;
}

export interface FeatureFlagsOpts {
  filePath?: string;
  pollIntervalMs?: number;
  clock?: () => number;
  hash?: (s: string) => number;                                            // 0-99
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

// ─── Default hash: sha256 → first 8 hex chars → int % 100 ────────────────────

function defaultHash(s: string): number {
  return parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16) % 100;
}

// ─── Rule matching ────────────────────────────────────────────────────────────

function matchRule(
  rule: { field: string; op: 'eq' | 'neq' | 'in' | 'gt' | 'lt'; value: unknown },
  ctx: EvalContext
): boolean {
  const actual = ctx[rule.field];
  switch (rule.op) {
    case 'eq':  return actual === rule.value;
    case 'neq': return actual !== rule.value;
    case 'in':  return Array.isArray(rule.value) && (rule.value as unknown[]).includes(actual);
    case 'gt':  return typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value;
    case 'lt':  return typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value;
    default:    return false;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFeatureFlags(opts: FeatureFlagsOpts = {}) {
  const {
    filePath,
    pollIntervalMs = 0,
    clock = Date.now,
    hash = defaultHash,
    setTimer = (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimer = (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  const flags = new Map<string, Flag>();
  let pollHandle: unknown = null;

  // ─── Core CRUD ──────────────────────────────────────────────────────────────

  function set(flag: Flag): void {
    flags.set(flag.key, flag);
  }

  function remove(key: string): boolean {
    return flags.delete(key);
  }

  function get(key: string): Flag | undefined {
    return flags.get(key);
  }

  function list(): Flag[] {
    return [...flags.values()];
  }

  function bulkSet(newFlags: Flag[]): void {
    flags.clear();
    for (const f of newFlags) {
      flags.set(f.key, f);
    }
  }

  // ─── Variant picker ──────────────────────────────────────────────────────────

  function pickVariant(flag: Flag, key: string, userId: string | undefined): string | undefined {
    if (!flag.variants || flag.variants.length === 0) return undefined;
    const totalWeight = flag.variants.reduce((s, v) => s + v.weight, 0);
    if (totalWeight === 0) return undefined;
    const bucket = hash(`${key}:${userId ?? 'anon'}`) % totalWeight;
    let cumulative = 0;
    for (const v of flag.variants) {
      cumulative += v.weight;
      if (bucket < cumulative) return v.name;
    }
    return flag.variants[flag.variants.length - 1].name;
  }

  // ─── Evaluation (ordered per spec) ──────────────────────────────────────────

  function evaluate(key: string, ctx: EvalContext = {}): EvalResult {
    const flag = flags.get(key);
    if (!flag) return { enabled: false, reason: 'unknown' };

    const now = clock();

    // 1. Expired
    if (flag.expiresAt !== undefined && now > flag.expiresAt) {
      return { enabled: false, reason: 'expired' };
    }

    // 2. Disabled
    if (!flag.enabled) {
      return { enabled: false, reason: 'disabled' };
    }

    const { userId } = ctx;

    // 3. Blocked
    if (userId !== undefined && flag.blockedUserIds?.includes(userId)) {
      return { enabled: false, reason: 'blocked' };
    }

    // 4. Allowlist
    if (userId !== undefined && flag.userIds?.includes(userId)) {
      return { enabled: true, variant: pickVariant(flag, key, userId), reason: 'allowlist' };
    }

    // 5. Rules — ALL must match
    if (flag.rules && flag.rules.length > 0) {
      for (const rule of flag.rules) {
        if (!matchRule(rule, ctx)) {
          return { enabled: false, reason: `rule:${rule.field}` };
        }
      }
    }

    // 6. Rollout
    if (flag.rollout !== undefined && flag.rollout < 100) {
      const bucket = hash(`${key}:${userId ?? 'anon'}`) % 100;
      if (bucket >= flag.rollout) {
        return { enabled: false, reason: 'rollout' };
      }
    }

    // 7. Variants + on
    const variant = pickVariant(flag, key, userId);
    return { enabled: true, variant, reason: 'on' };
  }

  function isEnabled(key: string, ctx?: EvalContext): boolean {
    return evaluate(key, ctx).enabled;
  }

  function variant(key: string, ctx?: EvalContext): string | undefined {
    return evaluate(key, ctx).variant;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  async function save(): Promise<void> {
    if (!filePath) return;
    const data = JSON.stringify([...flags.values()], null, 2);
    const dir = path.dirname(filePath);
    const tmpFile = path.join(
      dir,
      `.ff-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.promises.writeFile(tmpFile, data, 'utf8');
    await fs.promises.rename(tmpFile, filePath);
  }

  async function load(): Promise<void> {
    if (!filePath) return;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const loaded: Flag[] = JSON.parse(raw);
      for (const f of loaded) {
        flags.set(f.key, f);
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  // ─── Polling ──────────────────────────────────────────────────────────────────

  function scheduleNextPoll(): void {
    if (pollIntervalMs > 0) {
      pollHandle = setTimer(() => {
        load().catch(() => undefined).finally(scheduleNextPoll);
      }, pollIntervalMs);
    }
  }

  function startPolling(): void {
    if (pollIntervalMs <= 0) return;
    stopPolling();
    scheduleNextPoll();
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      clearTimer(pollHandle);
      pollHandle = null;
    }
  }

  return {
    set,
    remove,
    get,
    list,
    evaluate,
    isEnabled,
    variant,
    bulkSet,
    save,
    load,
    startPolling,
    stopPolling,
  };
}
