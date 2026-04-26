/**
 * queueDrainer — drains the offline queue when the daemon recovers.
 *
 * Listens for `apiEvents 'recovered'` (emitted by apiFetch after a failure
 * followed by a successful request) and serially replays each queued item
 * through a caller-supplied handler.
 *
 * The drain handler must be registered by a component (e.g. ChatPanel) via
 * `setDrainHandler` so the drainer never needs to own UI concerns like
 * rendering replayed messages.
 */

import { apiEvents } from './apiFetch';
import { list, remove } from './offlineQueue';
import type { QueuedItem } from './offlineQueue';

export type DrainHandler = (item: QueuedItem) => Promise<void>;

let _handler: DrainHandler | null = null;
let _draining = false;

/**
 * Register the function that will be called for each queued item during a
 * drain pass. Pass `null` to deregister (e.g. on component unmount).
 */
export function setDrainHandler(handler: DrainHandler | null): void {
  _handler = handler;
}

/**
 * Drain the queue serially.
 *
 * - Re-entrant calls are no-ops (guarded by an in-flight flag).
 * - On the first item failure the drain stops; remaining items stay queued.
 * - Successfully sent items are removed from the queue immediately.
 */
export async function drainNow(): Promise<void> {
  if (_draining || !_handler) return;
  _draining = true;
  try {
    const items = list();
    for (const item of items) {
      try {
        await _handler!(item);
        remove(item.id);
      } catch {
        // Stop on first failure — item remains in the queue for next attempt.
        break;
      }
    }
  } finally {
    _draining = false;
  }
}

// Auto-drain whenever the daemon becomes reachable again.
apiEvents.addEventListener('recovered', () => {
  drainNow().catch(() => {});
});
