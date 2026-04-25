// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createBundle } from './localization-bundle.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBundle(msgs: Record<string, unknown> = {}, locale = 'en') {
  const b = createBundle({ defaultLocale: locale });
  if (Object.keys(msgs).length) b.addMessages(locale, msgs);
  return b;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('localization-bundle', () => {
  // ── Lifecycle & locale management ──────────────────────────────────────────

  it('getLocale() returns defaultLocale on creation', () => {
    const b = createBundle({ defaultLocale: 'en' });
    expect(b.getLocale()).toBe('en');
  });

  it('setLocale() changes the current locale', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.setLocale('fr');
    expect(b.getLocale()).toBe('fr');
  });

  it('t() uses the locale set via setLocale()', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.addMessages('en', { hello: 'Hello' });
    b.addMessages('fr', { hello: 'Bonjour' });
    b.setLocale('fr');
    expect(b.t('hello')).toBe('Bonjour');
  });

  it('t() opts.locale overrides current locale', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.addMessages('en', { msg: 'English' });
    b.addMessages('de', { msg: 'Deutsch' });
    expect(b.t('msg', {}, { locale: 'de' })).toBe('Deutsch');
  });

  // ── Simple substitution ────────────────────────────────────────────────────

  it('simple {name} substitution', () => {
    const b = makeBundle({ hello: 'Hello, {name}!' });
    expect(b.t('hello', { name: 'World' })).toBe('Hello, World!');
  });

  it('multiple {param} substitutions in one message', () => {
    const b = makeBundle({ greet: '{greeting}, {name}!' });
    expect(b.t('greet', { greeting: 'Hi', name: 'Alice' })).toBe('Hi, Alice!');
  });

  it('unknown variable left as {varName} placeholder', () => {
    const b = makeBundle({ msg: 'Hello {unknown}' });
    expect(b.t('msg', {})).toBe('Hello {unknown}');
  });

  // ── Plural — English ───────────────────────────────────────────────────────

  describe('plural en', () => {
    let b: ReturnType<typeof makeBundle>;
    beforeEach(() => {
      b = makeBundle({ items: '{count, plural, one {# item} other {# items}}' });
    });
    it('n=1 → one', () => expect(b.t('items', { count: 1 })).toBe('1 item'));
    it('n=2 → other', () => expect(b.t('items', { count: 2 })).toBe('2 items'));
    it('n=0 → other', () => expect(b.t('items', { count: 0 })).toBe('0 items'));
  });

  // ── Plural — Russian ───────────────────────────────────────────────────────

  describe('plural ru (1/2/5/21/22)', () => {
    let b: ReturnType<typeof createBundle>;
    beforeEach(() => {
      b = createBundle({ defaultLocale: 'ru' });
      b.addMessages('ru', {
        items: '{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}',
      });
    });
    it('n=1  → one  (1 товар)',    () => expect(b.t('items', { count: 1 })).toBe('1 товар'));
    it('n=2  → few  (2 товара)',   () => expect(b.t('items', { count: 2 })).toBe('2 товара'));
    it('n=5  → many (5 товаров)',  () => expect(b.t('items', { count: 5 })).toBe('5 товаров'));
    it('n=21 → one  (21 товар)',   () => expect(b.t('items', { count: 21 })).toBe('21 товар'));
    it('n=22 → few  (22 товара)',  () => expect(b.t('items', { count: 22 })).toBe('22 товара'));
  });

  // ── Plural — Polish ────────────────────────────────────────────────────────

  describe('plural pl (1/2/5/21/22)', () => {
    let b: ReturnType<typeof createBundle>;
    beforeEach(() => {
      b = createBundle({ defaultLocale: 'pl' });
      b.addMessages('pl', {
        items: '{count, plural, one {# przedmiot} few {# przedmioty} many {# przedmiotów} other {# przedmiotu}}',
      });
    });
    it('n=1  → one  (1 przedmiot)',    () => expect(b.t('items', { count: 1 })).toBe('1 przedmiot'));
    it('n=2  → few  (2 przedmioty)',   () => expect(b.t('items', { count: 2 })).toBe('2 przedmioty'));
    it('n=5  → many (5 przedmiotów)',  () => expect(b.t('items', { count: 5 })).toBe('5 przedmiotów'));
    it('n=21 → many (21 przedmiotów)', () => expect(b.t('items', { count: 21 })).toBe('21 przedmiotów'));
    it('n=22 → few  (22 przedmioty)',  () => expect(b.t('items', { count: 22 })).toBe('22 przedmioty'));
  });

  // ── Select ────────────────────────────────────────────────────────────────

  describe('select gender', () => {
    const b = makeBundle({
      msg: '{gender, select, male {his book} female {her book} other {their book}}',
    });
    it('male',   () => expect(b.t('msg', { gender: 'male' })).toBe('his book'));
    it('female', () => expect(b.t('msg', { gender: 'female' })).toBe('her book'));
    it('other (unknown value falls through)', () =>
      expect(b.t('msg', { gender: 'nonbinary' })).toBe('their book'));
  });

  // ── Number / date / currency ───────────────────────────────────────────────

  it('{n, number} formats with Intl.NumberFormat', () => {
    const b = makeBundle({ val: 'Value: {n, number}' });
    const expected = `Value: ${new Intl.NumberFormat('en').format(1_234_567)}`;
    expect(b.t('val', { n: 1_234_567 })).toBe(expected);
  });

  it('{d, date, short} formats with Intl.DateTimeFormat short', () => {
    const d = new Date('2024-01-15T12:00:00Z');
    const b = makeBundle({ d: '{d, date, short}' });
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(d);
    expect(b.t('d', { d })).toBe(expected);
  });

  it('{d, date, long} formats with Intl.DateTimeFormat long', () => {
    const d = new Date('2024-06-01T00:00:00Z');
    const b = makeBundle({ d: '{d, date, long}' });
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(d);
    expect(b.t('d', { d })).toBe(expected);
  });

  it('{n, currency, USD} formats as currency', () => {
    const b = makeBundle({ price: 'Price: {n, currency, USD}' });
    const expected = `Price: ${new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(9.99)}`;
    expect(b.t('price', { n: 9.99 })).toBe(expected);
  });

  // ── Brace escaping ────────────────────────────────────────────────────────

  it("escape '{'  → literal {", () => {
    const b = makeBundle({ msg: "Open '{' brace" });
    expect(b.t('msg')).toBe('Open { brace');
  });

  it("escape '}'  → literal }", () => {
    const b = makeBundle({ msg: "Close '}' brace" });
    expect(b.t('msg')).toBe('Close } brace');
  });

  it("escape ''  → single quote", () => {
    const b = makeBundle({ msg: "It''s fine" });
    expect(b.t('msg')).toBe("It's fine");
  });

  // ── Missing key fallback chain ────────────────────────────────────────────

  it('missing key returns the key itself', () => {
    const b = createBundle({ defaultLocale: 'en' });
    expect(b.t('some.missing.key')).toBe('some.missing.key');
  });

  it('fallback chain: requestedLocale → fallbackLocale → defaultLocale → key', () => {
    const b = createBundle({ defaultLocale: 'en', fallbackLocale: 'fr' });
    b.addMessages('en', { onlyEn: 'English only' });
    b.addMessages('fr', { onlyFr: 'Français seulement' });

    // key in fallback locale (fr)
    expect(b.t('onlyFr', {}, { locale: 'de' })).toBe('Français seulement');
    // key in default locale (en)
    expect(b.t('onlyEn', {}, { locale: 'de' })).toBe('English only');
    // key nowhere → return key
    expect(b.t('nope', {}, { locale: 'de' })).toBe('nope');
  });

  // ── onMissing hook ────────────────────────────────────────────────────────

  it('onMissing called exactly once for a missing key', () => {
    const b = createBundle({ defaultLocale: 'en' });
    const handler = vi.fn();
    b.onMissing(handler);
    b.t('missing.key');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('en', 'missing.key');
  });

  it('onMissing NOT called again for the same key (deduped)', () => {
    const b = createBundle({ defaultLocale: 'en' });
    const handler = vi.fn();
    b.onMissing(handler);
    b.t('missing.key');
    b.t('missing.key');
    b.t('missing.key');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('onMissing called separately for different missing keys', () => {
    const b = createBundle({ defaultLocale: 'en' });
    const handler = vi.fn();
    b.onMissing(handler);
    b.t('key.a');
    b.t('key.b');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('onMissing NOT called when key is found', () => {
    const b = makeBundle({ hello: 'Hello' });
    const handler = vi.fn();
    b.onMissing(handler);
    b.t('hello');
    expect(handler).not.toHaveBeenCalled();
  });

  // ── withScope ─────────────────────────────────────────────────────────────

  it('withScope returns t bound to prefix', () => {
    const b = makeBundle({ 'errors.notFound': 'Not found', 'errors.timeout': 'Timeout' });
    const t = b.withScope('errors');
    expect(t('notFound')).toBe('Not found');
    expect(t('timeout')).toBe('Timeout');
  });

  it('withScope passes params correctly', () => {
    const b = makeBundle({ 'ui.title': 'Welcome, {name}!' });
    const t = b.withScope('ui');
    expect(t('title', { name: 'Bob' })).toBe('Welcome, Bob!');
  });

  // ── Nested keys (dot-path preflatten) ─────────────────────────────────────

  it('deeply nested keys are flattened via dot paths', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.addMessages('en', { errors: { notFound: 'Not found', server: { error: '500 Error' } } });
    expect(b.t('errors.notFound')).toBe('Not found');
    expect(b.t('errors.server.error')).toBe('500 Error');
  });

  // ── addMessages ───────────────────────────────────────────────────────────

  it('addMessages overrides existing keys', () => {
    const b = makeBundle({ hello: 'Hello' });
    b.addMessages('en', { hello: 'Hi' });
    expect(b.t('hello')).toBe('Hi');
  });

  it('addMessages preserves non-overridden keys', () => {
    const b = makeBundle({ hello: 'Hello', world: 'World' });
    b.addMessages('en', { hello: 'Hi' });
    expect(b.t('world')).toBe('World');
  });

  it('addMessages adds a new locale', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.addMessages('en', { msg: 'Hello' });
    b.addMessages('ja', { msg: 'こんにちは' });
    expect(b.t('msg', {}, { locale: 'ja' })).toBe('こんにちは');
  });

  // ── hasKey ────────────────────────────────────────────────────────────────

  it('hasKey() returns true for an existing key', () => {
    const b = makeBundle({ hello: 'Hello' });
    expect(b.hasKey('en', 'hello')).toBe(true);
  });

  it('hasKey() returns false for a missing key', () => {
    const b = makeBundle({ hello: 'Hello' });
    expect(b.hasKey('en', 'nope')).toBe(false);
  });

  it('hasKey() returns false for an unloaded locale', () => {
    const b = makeBundle({ hello: 'Hello' });
    expect(b.hasKey('fr', 'hello')).toBe(false);
  });

  // ── dump ──────────────────────────────────────────────────────────────────

  it('dump() returns a clone, not a live reference', () => {
    const b = makeBundle({ hello: 'Hello' });
    const d = b.dump('en');
    d['hello'] = 'MODIFIED';
    expect(b.t('hello')).toBe('Hello');
  });

  it('dump() returns the full flat map', () => {
    const b = createBundle({ defaultLocale: 'en' });
    b.addMessages('en', { a: { b: 'AB', c: 'AC' } });
    expect(b.dump('en')).toEqual({ 'a.b': 'AB', 'a.c': 'AC' });
  });

  it('dump() returns empty object for unknown locale', () => {
    const b = createBundle({ defaultLocale: 'en' });
    expect(b.dump('xx')).toEqual({});
  });

  // ── Async loader — rejected promise → graceful fallback ───────────────────

  it('rejected loader falls back silently to other locales', async () => {
    const b = createBundle({
      defaultLocale: 'en',
      fallbackLocale: 'fr',
      loader: (loc) =>
        loc === 'fr'
          ? Promise.reject(new Error('network error'))
          : Promise.resolve({}),
    });
    b.addMessages('en', { hello: 'Hello from en' });

    // loadLocale for 'fr' resolves (error swallowed) but nothing is stored.
    await b.loadLocale('fr');

    // t() for locale 'fr' falls back to 'en'.
    expect(b.t('hello', {}, { locale: 'fr' })).toBe('Hello from en');
  });

  it('successful custom loader fn stores messages', async () => {
    const b = createBundle({
      defaultLocale: 'en',
      loader: async (_loc) => ({ custom: 'from loader' }),
    });
    await b.loadLocale('en');
    expect(b.t('custom')).toBe('from loader');
  });

  it('loadLocale is idempotent (called twice resolves without re-loading)', async () => {
    let callCount = 0;
    const b = createBundle({
      defaultLocale: 'en',
      loader: async (_loc) => { callCount++; return { k: 'v' }; },
    });
    await b.loadLocale('en');
    await b.loadLocale('en'); // second call — already loaded
    expect(callCount).toBe(1);
    expect(b.t('k')).toBe('v');
  });

  // ── Disk loader (tmp dir) ─────────────────────────────────────────────────

  describe('disk loader (os.tmpdir)', () => {
    let testDir: string;

    beforeEach(() => {
      const rand = crypto.randomBytes(8).toString('hex');
      testDir = path.join(os.tmpdir(), `lb-test-${rand}`);
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('loads flat keys from a JSON file in dir', async () => {
      fs.writeFileSync(
        path.join(testDir, 'en.json'),
        JSON.stringify({ greeting: 'Hello from file' }),
      );
      const b = createBundle({ defaultLocale: 'en', dir: testDir });
      await b.loadLocale('en');
      expect(b.t('greeting')).toBe('Hello from file');
    });

    it('loads and flattens nested keys from a JSON file', async () => {
      fs.writeFileSync(
        path.join(testDir, 'en.json'),
        JSON.stringify({ errors: { notFound: 'File 404' } }),
      );
      const b = createBundle({ defaultLocale: 'en', dir: testDir });
      await b.loadLocale('en');
      expect(b.t('errors.notFound')).toBe('File 404');
    });

    it('missing file resolves (no throw) and t() returns key', async () => {
      const b = createBundle({ defaultLocale: 'en', dir: testDir });
      await b.loadLocale('xx'); // file does not exist
      expect(b.t('anything', {}, { locale: 'xx' })).toBe('anything');
    });

    it('loads a different locale file from the same dir', async () => {
      fs.writeFileSync(
        path.join(testDir, 'fr.json'),
        JSON.stringify({ hello: 'Bonjour' }),
      );
      const b = createBundle({ defaultLocale: 'en', dir: testDir });
      await b.loadLocale('fr');
      expect(b.t('hello', {}, { locale: 'fr' })).toBe('Bonjour');
    });
  });
});
