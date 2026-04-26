/**
 * offlineQueue — localStorage-backed queue for outbound chat messages.
 *
 * Key: pyrfor.offline.chat.queue.v1
 *
 * v1 limitation: File attachments (Blob/File objects) cannot be reliably
 * serialised to localStorage. For multipart messages, the text is queued but
 * the attachment files are dropped. A `hadAttachments` flag is stored so the
 * UI can inform the user that attachments were not preserved.
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

function read(): QueuedItem[] {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    return JSON.parse(raw) as QueuedItem[];
  } catch (e) {
    console.warn('[offlineQueue] corrupted localStorage entry, resetting:', e);
    return [];
  }
}

function write(items: QueuedItem[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.warn('[offlineQueue] localStorage write failed:', e);
  }
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
