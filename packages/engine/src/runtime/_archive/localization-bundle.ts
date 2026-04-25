import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type Loader = (locale: string) => Promise<Record<string, unknown>>;

export interface BundleOptions {
  defaultLocale: string;
  fallbackLocale?: string;
  dir?: string;
  loader?: Loader;
}

export interface TOptions {
  locale?: string;
}

export type TFunction = (
  key: string,
  params?: Record<string, unknown>,
  opts?: TOptions,
) => string;

export interface LocalizationBundle {
  setLocale(loc: string): void;
  getLocale(): string;
  addMessages(loc: string, obj: Record<string, unknown>): void;
  hasKey(loc: string, key: string): boolean;
  t: TFunction;
  withScope(prefix: string): TFunction;
  onMissing(handler: (locale: string, key: string) => void): void;
  dump(loc: string): Record<string, string>;
  loadLocale(loc: string): Promise<void>;
}

// ── Flatten nested object to dot-path keys ────────────────────────────────────

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flatten(v as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(v ?? '');
    }
  }
  return result;
}

// ── CLDR-ish plural rules ─────────────────────────────────────────────────────

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

function getPluralCategory(n: number, locale: string): PluralCategory {
  const lang = locale.split(/[-_]/)[0].toLowerCase();

  // n === 1 → one
  if (
    [
      'en', 'de', 'es', 'it', 'nl', 'sv', 'no', 'da', 'pt',
      'af', 'bg', 'ca', 'eo', 'et', 'fi', 'gl', 'hu', 'el',
    ].includes(lang)
  ) {
    return n === 1 ? 'one' : 'other';
  }

  // n <= 1 → one
  if (['fr', 'hi', 'hy'].includes(lang)) {
    return n <= 1 ? 'one' : 'other';
  }

  // Slavic: ru, uk
  if (['ru', 'uk'].includes(lang)) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'few';
    return 'many';
  }

  // Polish
  if (lang === 'pl') {
    if (n === 1) return 'one';
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
    return 'many';
  }

  // No plural distinctions
  if (['ja', 'zh', 'ko', 'vi', 'th'].includes(lang)) {
    return 'other';
  }

  return 'other';
}

// ── ICU-lite parser ───────────────────────────────────────────────────────────

/**
 * Skips a single-quote region starting at `i` (where `s[i] === '\''`).
 * Returns the index immediately after the region.
 *
 * ICU quote rules:
 *   `''`      → literal `'`  (two consecutive quotes)
 *   `'text'`  → literal `text` (everything between matching quotes)
 */
function skipQuoteRegion(s: string, i: number): number {
  i++; // skip opening '
  if (i < s.length && s[i] === "'") return i + 1; // '' → single '
  while (i < s.length && s[i] !== "'") i++;
  return i < s.length ? i + 1 : i; // skip closing '
}

/**
 * Finds the index of the closing `}` that matches the `{` at `start`.
 * Returns [innerContent, closingIndex]. Handles nested braces and quoted
 * regions (`'...'`) which must not affect depth counting.
 */
function readBracketContent(s: string, start: number): [string, number] {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    if (s[i] === "'") { i = skipQuoteRegion(s, i); continue; }
    if (s[i] === '{') {
      depth++;
    } else if (s[i] === '}') {
      depth--;
      if (depth === 0) return [s.slice(start + 1, i), i];
    }
    i++;
  }
  return [s.slice(start + 1), s.length - 1];
}

/** Finds the index of the first `,` at depth 0 (not inside `{…}` or `'…'`). */
function findTopLevelComma(s: string, from = 0): number {
  let depth = 0;
  let i = from;
  while (i < s.length) {
    if (s[i] === "'") { i = skipQuoteRegion(s, i); continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ',' && depth === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Parses the `key1 {content1} key2 {content2} …` syntax used in plural/select
 * options into a Map<key, content>.
 */
function parseOptions(s: string): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    let key = '';
    while (i < s.length && !/[\s{]/.test(s[i]!)) {
      key += s[i]; i++;
    }
    if (!key) { i++; continue; }
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i < s.length && s[i] === '{') {
      const [content, end] = readBracketContent(s, i);
      map.set(key, content);
      i = end + 1;
    }
  }
  return map;
}

function formatPlaceholder(
  content: string,
  params: Record<string, unknown>,
  locale: string,
): string {
  const firstComma = findTopLevelComma(content);
  if (firstComma === -1) {
    const varName = content.trim();
    const val = params[varName];
    return val !== undefined ? String(val) : `{${varName}}`;
  }

  const varName = content.slice(0, firstComma).trim();
  const afterVar = content.slice(firstComma + 1);
  const secondComma = findTopLevelComma(afterVar);

  let type: string;
  let typeArgs: string;
  if (secondComma === -1) {
    type = afterVar.trim();
    typeArgs = '';
  } else {
    type = afterVar.slice(0, secondComma).trim();
    typeArgs = afterVar.slice(secondComma + 1).trim();
  }

  const value = params[varName];

  switch (type) {
    case 'plural': {
      const n = Number(value ?? 0);
      const options = parseOptions(typeArgs);
      const category = getPluralCategory(n, locale);
      const exactKey = `=${n}`;
      const template =
        options.get(exactKey) ?? options.get(category) ?? options.get('other') ?? '';
      return parseAndFormat(template.replace(/#/g, String(n)), params, locale);
    }

    case 'select': {
      const strValue = String(value ?? '');
      const options = parseOptions(typeArgs);
      const template = options.get(strValue) ?? options.get('other') ?? '';
      return parseAndFormat(template, params, locale);
    }

    case 'number': {
      const n = Number(value ?? 0);
      try {
        return new Intl.NumberFormat(locale).format(n);
      } catch {
        return String(n);
      }
    }

    case 'date': {
      const style = (['short', 'medium', 'long', 'full'].includes(typeArgs)
        ? typeArgs
        : 'medium') as Intl.DateTimeFormatOptions['dateStyle'];
      try {
        const d = value instanceof Date ? value : new Date(String(value ?? ''));
        return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(d);
      } catch {
        return String(value ?? '');
      }
    }

    case 'currency': {
      const currency = typeArgs.trim();
      const n = Number(value ?? 0);
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
      } catch {
        return String(n);
      }
    }

    default:
      return `{${content}}`;
  }
}

/**
 * Formats `msg` by substituting ICU-lite placeholders using `params`.
 *
 * Quote rules (ICU-standard):
 *   `''`      → literal `'`
 *   `'text'`  → literal `text`  (anything between matching quotes)
 */
function parseAndFormat(
  msg: string,
  params: Record<string, unknown>,
  locale: string,
): string {
  let result = '';
  let i = 0;
  while (i < msg.length) {
    if (msg[i] === "'") {
      if (i + 1 < msg.length && msg[i + 1] === "'") {
        result += "'";
        i += 2;
        continue;
      }
      // Quoted literal region: emit everything between the two `'` verbatim.
      i++; // skip opening '
      while (i < msg.length && msg[i] !== "'") {
        result += msg[i];
        i++;
      }
      if (i < msg.length) i++; // skip closing '
      continue;
    }
    if (msg[i] === '{') {
      const [content, end] = readBracketContent(msg, i);
      result += formatPlaceholder(content, params, locale);
      i = end + 1;
    } else {
      result += msg[i];
      i++;
    }
  }
  return result;
}

// ── Bundle factory ────────────────────────────────────────────────────────────

export function createBundle(options: BundleOptions): LocalizationBundle {
  const { defaultLocale, fallbackLocale, dir, loader } = options;
  let currentLocale = defaultLocale;
  const messages = new Map<string, Record<string, string>>();
  const loaded = new Set<string>();
  const loadingPromises = new Map<string, Promise<void>>();
  let missingHandler: ((locale: string, key: string) => void) | null = null;
  const reportedMissing = new Set<string>();

  function getMessages(loc: string): Record<string, string> {
    return messages.get(loc) ?? {};
  }

  function loadLocale(loc: string): Promise<void> {
    if (loaded.has(loc)) return Promise.resolve();
    const existing = loadingPromises.get(loc);
    if (existing) return existing;

    const source: Promise<Record<string, unknown>> = (() => {
      if (loader) return loader(loc);
      if (dir) {
        try {
          const raw = readFileSync(join(dir, `${loc}.json`), 'utf-8');
          const parsed: unknown = JSON.parse(raw);
          if (
            parsed === null ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
          ) {
            return Promise.reject(new Error('Invalid JSON structure'));
          }
          return Promise.resolve(parsed as Record<string, unknown>);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.resolve({});
    })();

    const p = source.then(
      (data) => {
        const flat = flatten(data);
        messages.set(loc, { ...getMessages(loc), ...flat });
        loaded.add(loc);
        loadingPromises.delete(loc);
      },
      () => {
        // Silently handle loader errors; t() will fall back to other locales.
        loadingPromises.delete(loc);
      },
    );

    loadingPromises.set(loc, p);
    return p;
  }

  function lookup(loc: string, key: string): string | undefined {
    const msgs = getMessages(loc);
    return Object.prototype.hasOwnProperty.call(msgs, key)
      ? (msgs[key] as string)
      : undefined;
  }

  function resolve(key: string, locale: string): [string | undefined, string] {
    let val = lookup(locale, key);
    if (val !== undefined) return [val, locale];

    if (fallbackLocale && fallbackLocale !== locale) {
      val = lookup(fallbackLocale, key);
      if (val !== undefined) return [val, fallbackLocale];
    }

    if (defaultLocale !== locale && defaultLocale !== fallbackLocale) {
      val = lookup(defaultLocale, key);
      if (val !== undefined) return [val, defaultLocale];
    }

    return [undefined, locale];
  }

  function reportMissing(locale: string, key: string): void {
    if (!missingHandler) return;
    const mk = `${locale}\0${key}`;
    if (!reportedMissing.has(mk)) {
      reportedMissing.add(mk);
      missingHandler(locale, key);
    }
  }

  const t: TFunction = (key, params, opts) => {
    const locale = opts?.locale ?? currentLocale;

    // Trigger lazy background load (fire-and-forget) on first access.
    if (!loaded.has(locale) && !loadingPromises.has(locale) && (loader ?? dir)) {
      void loadLocale(locale);
    }

    const [template, resolvedLocale] = resolve(key, locale);
    if (template === undefined) {
      reportMissing(locale, key);
      return key;
    }
    return parseAndFormat(template, params ?? {}, resolvedLocale);
  };

  return {
    setLocale(loc: string) { currentLocale = loc; },
    getLocale() { return currentLocale; },

    addMessages(loc: string, obj: Record<string, unknown>) {
      const flat = flatten(obj);
      messages.set(loc, { ...getMessages(loc), ...flat });
      loaded.add(loc);
    },

    hasKey(loc: string, key: string) {
      return Object.prototype.hasOwnProperty.call(getMessages(loc), key);
    },

    t,

    withScope(prefix: string): TFunction {
      return (key, params, opts) => t(`${prefix}.${key}`, params, opts);
    },

    onMissing(handler: (locale: string, key: string) => void) {
      missingHandler = handler;
    },

    dump(loc: string) {
      return { ...getMessages(loc) };
    },

    loadLocale,
  };
}
