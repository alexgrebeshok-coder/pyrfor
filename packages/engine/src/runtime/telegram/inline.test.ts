import { describe, it, expect } from 'vitest';
import {
  buildHelpKeyboard,
  buildStatusKeyboard,
  buildClearConfirmKeyboard,
  parseCallback,
} from './inline';

// ─── buildHelpKeyboard ────────────────────────────────────────────────────────

describe('buildHelpKeyboard', () => {
  it('returns a valid InlineKeyboardMarkup shape', () => {
    const kb = buildHelpKeyboard();
    expect(kb).toHaveProperty('inline_keyboard');
    expect(Array.isArray(kb.inline_keyboard)).toBe(true);
    expect(kb.inline_keyboard.length).toBeGreaterThan(0);
  });

  it('every button has text and callback_data', () => {
    const kb = buildHelpKeyboard();
    for (const row of kb.inline_keyboard) {
      for (const btn of row) {
        expect(typeof btn.text).toBe('string');
        expect(btn.text.length).toBeGreaterThan(0);
        expect(typeof btn.callback_data).toBe('string');
        expect(btn.callback_data.length).toBeGreaterThan(0);
      }
    }
  });

  it('all callback_data values use help: namespace', () => {
    const kb = buildHelpKeyboard();
    const allData = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(allData.every((d) => d.startsWith('help:'))).toBe(true);
  });

  it('matches expected snapshot shape', () => {
    const kb = buildHelpKeyboard();
    expect(kb).toMatchObject({
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'help:status' },
          { text: '📋 Tasks', callback_data: 'help:tasks' },
        ],
        [
          { text: '📂 Projects', callback_data: 'help:projects' },
          { text: '☀️ Brief', callback_data: 'help:brief' },
        ],
        [
          { text: '🗑 Clear history', callback_data: 'help:clear' },
        ],
      ],
    });
  });
});

// ─── buildStatusKeyboard ──────────────────────────────────────────────────────

describe('buildStatusKeyboard', () => {
  it('healthy=true uses 🔄 refresh emoji', () => {
    const kb = buildStatusKeyboard({ healthy: true });
    const refreshBtn = kb.inline_keyboard[0][0];
    expect(refreshBtn.text).toContain('🔄');
  });

  it('healthy=false uses ⚠️ refresh emoji', () => {
    const kb = buildStatusKeyboard({ healthy: false });
    const refreshBtn = kb.inline_keyboard[0][0];
    expect(refreshBtn.text).toContain('⚠️');
  });

  it('callback_data values are the same regardless of health', () => {
    const healthy = buildStatusKeyboard({ healthy: true });
    const unhealthy = buildStatusKeyboard({ healthy: false });

    const extractCbs = (kb: ReturnType<typeof buildStatusKeyboard>) =>
      kb.inline_keyboard.flat().map((b) => b.callback_data);

    expect(extractCbs(healthy)).toEqual(extractCbs(unhealthy));
  });

  it('contains expected callbacks', () => {
    const kb = buildStatusKeyboard({ healthy: true });
    const cbs = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(cbs).toContain('status:refresh');
    expect(cbs).toContain('status:metrics');
    expect(cbs).toContain('status:check');
  });
});

// ─── buildClearConfirmKeyboard ────────────────────────────────────────────────

describe('buildClearConfirmKeyboard', () => {
  it('has exactly two buttons in one row', () => {
    const kb = buildClearConfirmKeyboard();
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
  });

  it('contains clear:yes and clear:no callbacks', () => {
    const kb = buildClearConfirmKeyboard();
    const cbs = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(cbs).toContain('clear:yes');
    expect(cbs).toContain('clear:no');
  });
});

// ─── parseCallback ────────────────────────────────────────────────────────────

describe('parseCallback', () => {
  it('parses a valid namespace:action string', () => {
    expect(parseCallback('status:refresh')).toEqual({ namespace: 'status', action: 'refresh' });
  });

  it('handles action containing a colon (only first colon splits)', () => {
    expect(parseCallback('ns:act:extra')).toEqual({ namespace: 'ns', action: 'act:extra' });
  });

  it('returns null for empty string', () => {
    expect(parseCallback('')).toBeNull();
  });

  it('returns null when there is no colon', () => {
    expect(parseCallback('justaction')).toBeNull();
  });

  it('returns null when namespace is empty', () => {
    expect(parseCallback(':action')).toBeNull();
  });

  it('returns null when action is empty', () => {
    expect(parseCallback('namespace:')).toBeNull();
  });

  it('returns null for non-string input (cast via any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCallback(null as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseCallback(undefined as any)).toBeNull();
  });

  it('parses various namespaces correctly', () => {
    expect(parseCallback('help:clear')).toEqual({ namespace: 'help', action: 'clear' });
    expect(parseCallback('clear:yes')).toEqual({ namespace: 'clear', action: 'yes' });
    expect(parseCallback('clear:no')).toEqual({ namespace: 'clear', action: 'no' });
  });

  it('parses action containing a slash', () => {
    expect(parseCallback('ns:/path/to')).toEqual({ namespace: 'ns', action: '/path/to' });
  });

  it('parses action containing unicode characters', () => {
    expect(parseCallback('ns:café')).toEqual({ namespace: 'ns', action: 'café' });
    expect(parseCallback('ns:日本語')).toEqual({ namespace: 'ns', action: '日本語' });
  });

  it('parses action containing emoji', () => {
    expect(parseCallback('ns:🔄')).toEqual({ namespace: 'ns', action: '🔄' });
    expect(parseCallback('status:⚠️')).toEqual({ namespace: 'status', action: '⚠️' });
  });

  it('parses action containing whitespace', () => {
    expect(parseCallback('ns:hello world')).toEqual({ namespace: 'ns', action: 'hello world' });
    expect(parseCallback('ns:  leading')).toEqual({ namespace: 'ns', action: '  leading' });
  });

  it('parses action containing only numerics', () => {
    expect(parseCallback('task:42')).toEqual({ namespace: 'task', action: '42' });
    expect(parseCallback('page:0')).toEqual({ namespace: 'page', action: '0' });
  });

  it('is limit-agnostic — parses strings longer than 64 bytes', () => {
    const longData = 'ns:' + 'a'.repeat(100);
    const result = parseCallback(longData);
    expect(result).not.toBeNull();
    expect(result!.namespace).toBe('ns');
    expect(result!.action).toBe('a'.repeat(100));
  });
});

// ─── Telegram 64-byte callback_data limit ─────────────────────────────────────

describe('Telegram 64-byte callback_data limit', () => {
  it('all buildHelpKeyboard callback_data values are within 64 bytes', () => {
    const kb = buildHelpKeyboard();
    for (const row of kb.inline_keyboard) {
      for (const btn of row) {
        expect(new TextEncoder().encode(btn.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('all buildStatusKeyboard callback_data values are within 64 bytes', () => {
    for (const healthy of [true, false]) {
      const kb = buildStatusKeyboard({ healthy });
      for (const row of kb.inline_keyboard) {
        for (const btn of row) {
          expect(new TextEncoder().encode(btn.callback_data).length).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  it('all buildClearConfirmKeyboard callback_data values are within 64 bytes', () => {
    const kb = buildClearConfirmKeyboard();
    for (const row of kb.inline_keyboard) {
      for (const btn of row) {
        expect(new TextEncoder().encode(btn.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });
});

// ─── Built-in keyboard layout ─────────────────────────────────────────────────

describe('built-in keyboard layout', () => {
  it('buildHelpKeyboard has 3 rows with correct column counts', () => {
    const kb = buildHelpKeyboard();
    expect(kb.inline_keyboard).toHaveLength(3);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
    expect(kb.inline_keyboard[1]).toHaveLength(2);
    expect(kb.inline_keyboard[2]).toHaveLength(1);
  });

  it('buildStatusKeyboard has 2 rows with correct column counts', () => {
    const kb = buildStatusKeyboard({ healthy: true });
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
    expect(kb.inline_keyboard[1]).toHaveLength(1);
  });

  it('all built-in keyboard callback_data values are parseable by parseCallback', () => {
    const keyboards = [
      buildHelpKeyboard(),
      buildStatusKeyboard({ healthy: true }),
      buildStatusKeyboard({ healthy: false }),
      buildClearConfirmKeyboard(),
    ];
    for (const kb of keyboards) {
      for (const row of kb.inline_keyboard) {
        for (const btn of row) {
          const parsed = parseCallback(btn.callback_data);
          expect(parsed).not.toBeNull();
          expect(parsed!.namespace.length).toBeGreaterThan(0);
          expect(parsed!.action.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('buildHelpKeyboard returns a fresh object on each call (immutability)', () => {
    const kb1 = buildHelpKeyboard();
    const kb2 = buildHelpKeyboard();
    expect(kb1).not.toBe(kb2);
    expect(kb1.inline_keyboard).not.toBe(kb2.inline_keyboard);
  });

  it('buildStatusKeyboard returns a fresh object on each call (immutability)', () => {
    const kb1 = buildStatusKeyboard({ healthy: true });
    const kb2 = buildStatusKeyboard({ healthy: true });
    expect(kb1).not.toBe(kb2);
    expect(kb1.inline_keyboard).not.toBe(kb2.inline_keyboard);
  });

  it('buildClearConfirmKeyboard returns a fresh object on each call (immutability)', () => {
    const kb1 = buildClearConfirmKeyboard();
    const kb2 = buildClearConfirmKeyboard();
    expect(kb1).not.toBe(kb2);
    expect(kb1.inline_keyboard).not.toBe(kb2.inline_keyboard);
  });
});
