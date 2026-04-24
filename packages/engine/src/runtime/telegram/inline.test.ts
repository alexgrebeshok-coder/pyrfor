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
});
