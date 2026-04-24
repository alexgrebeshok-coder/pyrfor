// @vitest-environment node
/**
 * telegram-keyboards.test.ts
 *
 * ≥ 30 tests covering shape, column layout, edge pages, parseCallback,
 * router dispatch, callback_data ≤ 64 bytes, and label truncation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  confirmKeyboard,
  choiceKeyboard,
  paginatedListKeyboard,
  menuKeyboard,
  cancelKeyboard,
  parseCallback,
  createCallbackRouter,
  type InlineButton,
  type InlineKeyboard,
} from './telegram-keyboards.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function byteLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c < 0xd800 || c > 0xdfff) n += 3;
    else { n += 2; i++; }
  }
  return n;
}

function allButtons(kb: InlineKeyboard): InlineButton[] {
  return kb.inline_keyboard.flat();
}

function allCallbackData(kb: InlineKeyboard): string[] {
  return allButtons(kb).map((b) => b.callback_data);
}

// ─── confirmKeyboard ──────────────────────────────────────────────────────────

describe('confirmKeyboard', () => {
  it('returns exactly one row', () => {
    const kb = confirmKeyboard('delete-item');
    expect(kb.inline_keyboard).toHaveLength(1);
  });

  it('row has exactly 2 buttons', () => {
    const kb = confirmKeyboard('delete-item');
    expect(kb.inline_keyboard[0]).toHaveLength(2);
  });

  it('default labels are "Yes" and "No"', () => {
    const kb = confirmKeyboard('x');
    const [yes, no] = kb.inline_keyboard[0];
    expect(yes.text).toBe('Yes');
    expect(no.text).toBe('No');
  });

  it('accepts custom yesText / noText', () => {
    const kb = confirmKeyboard('x', { yesText: 'Confirm', noText: 'Abort' });
    const [yes, no] = kb.inline_keyboard[0];
    expect(yes.text).toBe('Confirm');
    expect(no.text).toBe('Abort');
  });

  it('callback_data encodes actionId for yes', () => {
    const kb = confirmKeyboard('my-action');
    expect(kb.inline_keyboard[0][0].callback_data).toBe('confirm:yes:my-action');
  });

  it('callback_data encodes actionId for no', () => {
    const kb = confirmKeyboard('my-action');
    expect(kb.inline_keyboard[0][1].callback_data).toBe('confirm:no:my-action');
  });

  it('all callback_data ≤ 64 bytes even with a long actionId', () => {
    const longId = 'a'.repeat(60);
    const kb = confirmKeyboard(longId);
    for (const cb of allCallbackData(kb)) {
      expect(byteLen(cb)).toBeLessThanOrEqual(64);
    }
  });
});

// ─── choiceKeyboard ───────────────────────────────────────────────────────────

describe('choiceKeyboard', () => {
  const choices = ['Alpha', 'Beta', 'Gamma', 'Delta'];

  it('default: 1 column → 4 rows for 4 choices', () => {
    const kb = choiceKeyboard('quiz', choices);
    expect(kb.inline_keyboard).toHaveLength(4);
    expect(kb.inline_keyboard.every((r) => r.length === 1)).toBe(true);
  });

  it('2 columns → ceil(4/2) = 2 rows', () => {
    const kb = choiceKeyboard('quiz', choices, { columns: 2 });
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
  });

  it('3 columns → 2 rows (3+1)', () => {
    const kb = choiceKeyboard('quiz', choices, { columns: 3 });
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(3);
    expect(kb.inline_keyboard[1]).toHaveLength(1);
  });

  it('callback_data uses index not label', () => {
    const kb = choiceKeyboard('q', ['A', 'B', 'C']);
    const cbs = allCallbackData(kb);
    expect(cbs).toEqual(['choice:q:0', 'choice:q:1', 'choice:q:2']);
  });

  it('button text matches the choice label', () => {
    const kb = choiceKeyboard('q', ['Option A', 'Option B']);
    expect(kb.inline_keyboard[0][0].text).toBe('Option A');
  });

  it('all callback_data ≤ 64 bytes with long actionId', () => {
    const longId = 'z'.repeat(50);
    const kb = choiceKeyboard(longId, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    for (const cb of allCallbackData(kb)) {
      expect(byteLen(cb)).toBeLessThanOrEqual(64);
    }
  });
});

// ─── paginatedListKeyboard ────────────────────────────────────────────────────

const makeItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Item ${i + 1}`, id: `id${i}` }));

describe('paginatedListKeyboard', () => {
  it('shows correct slice of items on page 0', () => {
    const kb = paginatedListKeyboard(makeItems(10), 0, 3, 'list');
    // 3 item rows + 1 nav row
    expect(kb.inline_keyboard).toHaveLength(4);
    expect(kb.inline_keyboard[0][0].text).toBe('Item 1');
    expect(kb.inline_keyboard[2][0].text).toBe('Item 3');
  });

  it('prev button is noop on first page', () => {
    const kb = paginatedListKeyboard(makeItems(9), 0, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[0].callback_data).toBe('noop');
  });

  it('next button is active on first page when more pages exist', () => {
    const kb = paginatedListKeyboard(makeItems(9), 0, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[2].callback_data).toBe('page:a:next');
  });

  it('next button is noop on last page', () => {
    const kb = paginatedListKeyboard(makeItems(9), 2, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[2].callback_data).toBe('noop');
  });

  it('prev button is active on last page', () => {
    const kb = paginatedListKeyboard(makeItems(9), 2, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[0].callback_data).toBe('page:a:prev');
  });

  it('both nav buttons active on middle page', () => {
    const kb = paginatedListKeyboard(makeItems(9), 1, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[0].callback_data).toBe('page:a:prev');
    expect(navRow[2].callback_data).toBe('page:a:next');
  });

  it('page info button shows n/total and uses noop', () => {
    const kb = paginatedListKeyboard(makeItems(9), 1, 3, 'a');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[1].text).toBe('2/3');
    expect(navRow[1].callback_data).toBe('noop');
  });

  it('item callback_data uses select: prefix', () => {
    const kb = paginatedListKeyboard([{ label: 'Foo', id: 'foo123' }], 0, 5, 'mylist');
    expect(kb.inline_keyboard[0][0].callback_data).toBe('select:mylist:foo123');
  });

  it('all callback_data ≤ 64 bytes with long actionId', () => {
    const longId = 'p'.repeat(50);
    const kb = paginatedListKeyboard(makeItems(15), 1, 5, longId);
    for (const cb of allCallbackData(kb)) {
      expect(byteLen(cb)).toBeLessThanOrEqual(64);
    }
  });

  it('single-page list: both nav buttons are noop', () => {
    const kb = paginatedListKeyboard(makeItems(2), 0, 5, 'single');
    const navRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(navRow[0].callback_data).toBe('noop');
    expect(navRow[2].callback_data).toBe('noop');
  });
});

// ─── menuKeyboard ─────────────────────────────────────────────────────────────

describe('menuKeyboard', () => {
  it('default 1 column: each item in its own row', () => {
    const kb = menuKeyboard([
      { label: 'Home', callback: 'menu:nav:home' },
      { label: 'Settings', callback: 'menu:nav:settings' },
    ]);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(1);
  });

  it('2 columns: groups into pairs', () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      label: `Item ${i}`,
      callback: `cb${i}`,
    }));
    const kb = menuKeyboard(items, 2);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
  });

  it('passes through user-supplied callback unchanged (within 64 bytes)', () => {
    const kb = menuKeyboard([{ label: 'Go', callback: 'menu:root:go' }]);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('menu:root:go');
  });

  it('all callback_data ≤ 64 bytes', () => {
    const items = [{ label: 'X', callback: 'c'.repeat(70) }];
    const kb = menuKeyboard(items);
    for (const cb of allCallbackData(kb)) {
      expect(byteLen(cb)).toBeLessThanOrEqual(64);
    }
  });
});

// ─── cancelKeyboard ───────────────────────────────────────────────────────────

describe('cancelKeyboard', () => {
  it('has exactly one row with one button', () => {
    const kb = cancelKeyboard('upload');
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0]).toHaveLength(1);
  });

  it('button text is "Cancel"', () => {
    const kb = cancelKeyboard('upload');
    expect(kb.inline_keyboard[0][0].text).toBe('Cancel');
  });

  it('callback_data is cancel:<actionId>', () => {
    const kb = cancelKeyboard('upload');
    expect(kb.inline_keyboard[0][0].callback_data).toBe('cancel:upload');
  });

  it('callback_data ≤ 64 bytes with long actionId', () => {
    const kb = cancelKeyboard('x'.repeat(60));
    expect(byteLen(kb.inline_keyboard[0][0].callback_data)).toBeLessThanOrEqual(64);
  });
});

// ─── parseCallback ────────────────────────────────────────────────────────────

describe('parseCallback', () => {
  it('parses confirm:yes', () => {
    const p = parseCallback('confirm:yes:delete-item');
    expect(p.kind).toBe('confirm');
    expect(p.actionId).toBe('delete-item');
    expect(p.payload).toBe('yes');
  });

  it('parses confirm:no', () => {
    const p = parseCallback('confirm:no:delete-item');
    expect(p.kind).toBe('confirm');
    expect(p.payload).toBe('no');
  });

  it('parses choice', () => {
    const p = parseCallback('choice:quiz:2');
    expect(p.kind).toBe('choice');
    expect(p.actionId).toBe('quiz');
    expect(p.payload).toBe('2');
  });

  it('parses page:prev', () => {
    const p = parseCallback('page:mylist:prev');
    expect(p.kind).toBe('page');
    expect(p.actionId).toBe('mylist');
    expect(p.payload).toBe('prev');
  });

  it('parses page:next', () => {
    const p = parseCallback('page:mylist:next');
    expect(p.kind).toBe('page');
    expect(p.payload).toBe('next');
  });

  it('parses select', () => {
    const p = parseCallback('select:mylist:item-42');
    expect(p.kind).toBe('select');
    expect(p.actionId).toBe('mylist');
    expect(p.payload).toBe('item-42');
  });

  it('parses cancel', () => {
    const p = parseCallback('cancel:upload');
    expect(p.kind).toBe('cancel');
    expect(p.actionId).toBe('upload');
    expect(p.payload).toBeUndefined();
  });

  it('parses menu', () => {
    const p = parseCallback('menu:nav:home');
    expect(p.kind).toBe('menu');
    expect(p.actionId).toBe('nav');
    expect(p.payload).toBe('home');
  });

  it('returns unknown for unrecognised prefix', () => {
    const p = parseCallback('foo:bar:baz');
    expect(p.kind).toBe('unknown');
    expect(p.actionId).toBe('');
  });

  it('returns unknown for "noop"', () => {
    const p = parseCallback('noop');
    expect(p.kind).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    const p = parseCallback('');
    expect(p.kind).toBe('unknown');
  });

  it('handles actionId containing colons (select)', () => {
    // select:<actionId>:<id> — id may have colons
    const p = parseCallback('select:list:item:with:colons');
    expect(p.kind).toBe('select');
    expect(p.actionId).toBe('list');
    expect(p.payload).toBe('item:with:colons');
  });
});

// ─── createCallbackRouter ─────────────────────────────────────────────────────

describe('createCallbackRouter', () => {
  it('handle returns false when no handler registered', async () => {
    const router = createCallbackRouter();
    const result = await router.handle('confirm:yes:x');
    expect(result).toBe(false);
  });

  it('handle returns true when a handler is registered and succeeds', async () => {
    const router = createCallbackRouter();
    router.register('confirm', vi.fn().mockResolvedValue(undefined));
    const result = await router.handle('confirm:yes:x');
    expect(result).toBe(true);
  });

  it('handler receives parsed callback', async () => {
    const router = createCallbackRouter();
    const handler = vi.fn().mockResolvedValue(undefined);
    router.register('cancel', handler);
    await router.handle('cancel:upload');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cancel', actionId: 'upload' }),
      undefined,
    );
  });

  it('handler receives ctx argument', async () => {
    const router = createCallbackRouter();
    const handler = vi.fn().mockResolvedValue(undefined);
    router.register('choice', handler);
    const fakeCtx = { reply: vi.fn() };
    await router.handle('choice:q:0', fakeCtx);
    expect(handler).toHaveBeenCalledWith(expect.anything(), fakeCtx);
  });

  it('handle returns false and logs warning when handler throws', async () => {
    const router = createCallbackRouter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    router.register('select', () => { throw new Error('boom'); });
    const result = await router.handle('select:list:id1');
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('handle returns false for unknown kind when no handler', async () => {
    const router = createCallbackRouter();
    const result = await router.handle('noop');
    expect(result).toBe(false);
  });

  it('registering a handler for unknown kind still dispatches', async () => {
    const router = createCallbackRouter();
    const handler = vi.fn().mockResolvedValue(undefined);
    router.register('unknown', handler);
    const result = await router.handle('noop');
    expect(result).toBe(true);
  });

  it('second register for same kind overwrites first', async () => {
    const router = createCallbackRouter();
    const h1 = vi.fn();
    const h2 = vi.fn().mockResolvedValue(undefined);
    router.register('cancel', h1);
    router.register('cancel', h2);
    await router.handle('cancel:x');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });
});

// ─── Label truncation safety ──────────────────────────────────────────────────

describe('label safety: truncation > 64 bytes', () => {
  it('ASCII label of 65 chars is truncated to ≤ 64 bytes with ellipsis', () => {
    const longLabel = 'A'.repeat(65);
    const kb = confirmKeyboard('x', { yesText: longLabel, noText: 'No' });
    const text = kb.inline_keyboard[0][0].text;
    expect(text.endsWith('…')).toBe(true);
    expect(byteLen(text)).toBeLessThanOrEqual(64);
  });

  it('multi-byte label truncation still ≤ 64 bytes', () => {
    // Each "é" is 2 bytes; 35 × "é" = 70 bytes
    const longLabel = 'é'.repeat(35);
    const kb = cancelKeyboard('x');
    // Inject via menuKeyboard instead
    const mkb = menuKeyboard([{ label: longLabel, callback: 'menu:a:b' }]);
    const text = mkb.inline_keyboard[0][0].text;
    expect(byteLen(text)).toBeLessThanOrEqual(64);
  });

  it('exact 64-byte ASCII label is not truncated', () => {
    const exact = 'B'.repeat(64);
    const kb = menuKeyboard([{ label: exact, callback: 'c' }]);
    expect(kb.inline_keyboard[0][0].text).toBe(exact);
    expect(kb.inline_keyboard[0][0].text.endsWith('…')).toBe(false);
  });
});
