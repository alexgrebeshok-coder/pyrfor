/**
 * offlineQueue — in-memory queue for outbound chat messages.
 *
 * The queue deliberately avoids persistent browser storage because outbound
 * chat payloads can include local paths, selected file content, prompts and
 * other sensitive operator context. A legacy localStorage key is cleared on
 * access for users upgrading from older builds.
 */

export interface QueuedItemPayload {
  text: string;
  openFiles?: Array<{ path: string; content: string; language?: string }>;
  workspace?: string;
  sessionId?: string;
  /** True when the original message had file attachments that were dropped. */
  hadAttachments?: boolean;
}

export interface QueuedItem {
  id: string;
  ts: number;
  kind: 'text' | 'multipart';
  payload: QueuedItemPayload;
}

const STORAGE_KEY = 'pyrfor.offline.chat.queue.v1';
const listeners = new Set<() => void>();
let memoryQueue: QueuedItem[] = [];

// ─── Cross-tab sync ──────────────────────────────────────────────────────────

let bc: BroadcastChannel | null = null;

if (typeof BroadcastChannel !== 'undefined') {
  bc = new BroadcastChannel('pyrfor.offline.chat.queue');
  bc.onmessage = () => notifyLocal();
} else if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) notifyLocal();
  });
}

function notifyLocal(): void {
  listeners.forEach((cb) => cb());
}

function broadcast(): void {
  notifyLocal();
  try { bc?.postMessage('change'); } catch { /* ignore */ }
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

function cloneItem(item: QueuedItem): QueuedItem {
  return {
    ...item,
    payload: {
      ...item.payload,
      openFiles: item.payload.openFiles?.map((file) => ({ ...file })),
    },
  };
}

function clearLegacyStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore browser storage failures.
  }
}

clearLegacyStorage();

function read(): QueuedItem[] {
  clearLegacyStorage();
  return memoryQueue.map(cloneItem);
}

function write(items: QueuedItem[]): void {
  memoryQueue = items.map(cloneItem);
  clearLegacyStorage();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Append an item to the queue and return its generated id. */
export function enqueue(item: Omit<QueuedItem, 'id' | 'ts'>): string {
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = Date.now();
  const items = read();
  items.push({ ...item, id, ts });
  write(items);
  broadcast();
  return id;
}

/** Return a snapshot of the current queue. */
export function list(): QueuedItem[] {
  return read();
}

/** Remove a single item by id. */
export function remove(id: string): void {
  const items = read().filter((i) => i.id !== id);
  write(items);
  broadcast();
}

/** Remove all queued items. */
export function clear(): void {
  write([]);
  broadcast();
}

/**
 * Subscribe to queue changes (enqueue / remove / clear).
 * Works across tabs via BroadcastChannel (or storage event as fallback).
 *
 * @returns An unsubscribe function.
 */
export function onChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
