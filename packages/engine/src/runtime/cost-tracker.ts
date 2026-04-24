/**
 * cost-tracker.ts — Per-model token usage and dollar cost tracker for the Pyrfor engine.
 *
 * Features:
 * - Per-model pricing configuration
 * - Time-windowed spend queries (hour/day/month/total)
 * - Budget alerts with deduplication per window epoch
 * - Atomic file persistence (tmp + rename)
 * - Injectable clock for deterministic testing
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

export interface UsageRecord {
  ts: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  meta?: Record<string, unknown>;
}

export interface BudgetAlert {
  id: string;
  level: 'warn' | 'critical';
  threshold: number;
  window: 'hour' | 'day' | 'month' | 'total';
}

// ─── Internal ─────────────────────────────────────────────────────────────────

interface PersistencePayload {
  version: 1;
  records: UsageRecord[];
  pricing: Record<string, ModelPricing>;
  alerts: BudgetAlert[];
}

const WINDOW_MS: Record<BudgetAlert['window'], number> = {
  hour: 3_600_000,
  day: 86_400_000,
  month: 30 * 86_400_000,
  total: Infinity,
};

function windowEpoch(window: BudgetAlert['window'], now: number): number {
  const ms = WINDOW_MS[window];
  if (!isFinite(ms)) return 0;
  return Math.floor(now / ms);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CostTrackerOptions {
  pricing?: Record<string, ModelPricing>;
  persistPath?: string;
  clock?: () => number;
  onAlert?: (alert: BudgetAlert, currentSpend: number) => void;
}

export interface CostTracker {
  record(
    model: string,
    prompt: number,
    completion: number,
    meta?: Record<string, unknown>,
  ): UsageRecord;
  setPricing(model: string, pricing: ModelPricing): void;
  addAlert(alert: BudgetAlert): void;
  removeAlert(id: string): boolean;
  getSpend(window: BudgetAlert['window'], model?: string): number;
  getTokens(
    window: BudgetAlert['window'],
    model?: string,
  ): { prompt: number; completion: number; total: number };
  getStats(): {
    totalCost: number;
    totalTokens: number;
    perModel: Record<
      string,
      { cost: number; prompt: number; completion: number; calls: number }
    >;
  };
  getRecent(limit?: number): UsageRecord[];
  clear(): void;
  save(): void;
  load(): void;
}

export function createCostTracker(opts: CostTrackerOptions = {}): CostTracker {
  const clock = opts.clock ?? (() => Date.now());
  const onAlert = opts.onAlert;
  const persistPath = opts.persistPath;

  let records: UsageRecord[] = [];
  let pricing: Record<string, ModelPricing> = { ...(opts.pricing ?? {}) };
  let alerts: BudgetAlert[] = [];

  // Tracks last epoch at which each alert was triggered: alertId → epoch
  const triggeredEpoch = new Map<string, number>();

  // ── helpers ──────────────────────────────────────────────────────────────

  function computeCost(model: string, prompt: number, completion: number): number {
    const p = pricing[model];
    if (!p) return 0;
    return (prompt / 1000) * p.promptPer1k + (completion / 1000) * p.completionPer1k;
  }

  function recordsInWindow(
    window: BudgetAlert['window'],
    now: number,
    model?: string,
  ): UsageRecord[] {
    const ms = WINDOW_MS[window];
    const cutoff = isFinite(ms) ? now - ms : -Infinity;
    return records.filter(
      (r) => r.ts >= cutoff && (model === undefined || r.model === model),
    );
  }

  function evaluateAlerts(now: number): void {
    if (!onAlert) return;
    for (const alert of alerts) {
      const spend = tracker.getSpend(alert.window);
      if (spend >= alert.threshold) {
        const epoch = windowEpoch(alert.window, now);
        if (triggeredEpoch.get(alert.id) !== epoch) {
          triggeredEpoch.set(alert.id, epoch);
          onAlert(alert, spend);
        }
      }
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  const tracker: CostTracker = {
    record(model, prompt, completion, meta) {
      const ts = clock();
      const cost = computeCost(model, prompt, completion);
      const rec: UsageRecord = {
        ts,
        model,
        promptTokens: prompt,
        completionTokens: completion,
        cost,
        ...(meta !== undefined ? { meta } : {}),
      };
      records.push(rec);
      evaluateAlerts(ts);
      return rec;
    },

    setPricing(model, p) {
      pricing[model] = p;
    },

    addAlert(alert) {
      alerts.push(alert);
    },

    removeAlert(id) {
      const before = alerts.length;
      alerts = alerts.filter((a) => a.id !== id);
      triggeredEpoch.delete(id);
      return alerts.length < before;
    },

    getSpend(window, model?) {
      const now = clock();
      return recordsInWindow(window, now, model).reduce((s, r) => s + r.cost, 0);
    },

    getTokens(window, model?) {
      const now = clock();
      const recs = recordsInWindow(window, now, model);
      const prompt = recs.reduce((s, r) => s + r.promptTokens, 0);
      const completion = recs.reduce((s, r) => s + r.completionTokens, 0);
      return { prompt, completion, total: prompt + completion };
    },

    getStats() {
      const perModel: Record<
        string,
        { cost: number; prompt: number; completion: number; calls: number }
      > = {};
      for (const r of records) {
        if (!perModel[r.model]) {
          perModel[r.model] = { cost: 0, prompt: 0, completion: 0, calls: 0 };
        }
        const m = perModel[r.model];
        m.cost += r.cost;
        m.prompt += r.promptTokens;
        m.completion += r.completionTokens;
        m.calls += 1;
      }
      const totalCost = records.reduce((s, r) => s + r.cost, 0);
      const totalTokens = records.reduce(
        (s, r) => s + r.promptTokens + r.completionTokens,
        0,
      );
      return { totalCost, totalTokens, perModel };
    },

    getRecent(limit = records.length) {
      return [...records].reverse().slice(0, limit);
    },

    clear() {
      records = [];
      triggeredEpoch.clear();
    },

    save() {
      if (!persistPath) return;
      const payload: PersistencePayload = { version: 1, records, pricing, alerts };
      const json = JSON.stringify(payload, null, 2);
      const dir = path.dirname(persistPath);
      const tmp = path.join(dir, `.cost-tracker-${process.pid}.tmp`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, json, 'utf8');
      fs.renameSync(tmp, persistPath);
    },

    load() {
      if (!persistPath) return;
      if (!fs.existsSync(persistPath)) return;
      const raw = fs.readFileSync(persistPath, 'utf8');
      const payload = JSON.parse(raw) as PersistencePayload;
      if (payload.version !== 1) throw new Error('Unsupported version');
      records = payload.records ?? [];
      pricing = payload.pricing ?? {};
      alerts = payload.alerts ?? [];
    },
  };

  return tracker;
}
