/**
 * web-fetch-cleaner.ts — HTML → clean Markdown sanitizer for LLM ingestion
 *
 * Part of the Pyrfor engine runtime. No external dependencies — pure Node.js
 * regex / state-machine HTML processing.
 */

// ─── Options ─────────────────────────────────────────────────────────────────

export interface HtmlToMarkdownOptions {
  baseUrl?: string;
  maxLength?: number;
  preserveImages?: boolean;
}

export interface MetaInfo {
  title?: string;
  description?: string;
  author?: string;
  canonical?: string;
  ogImage?: string;
}

// ─── Entity decoding ──────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  hellip: '…',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  agrave: 'à',
  aacute: 'á',
  ocirc: 'ô',
  uuml: 'ü',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

// ─── Low-level HTML helpers ───────────────────────────────────────────────────

/** Remove HTML comments */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Remove a tag and all its contents (including nested same-tag occurrences) */
function stripTagWithContent(html: string, tag: string): string {
  // Iteratively strip outermost occurrences to handle nesting
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
  const close = new RegExp(`</${tag}>`, 'gi');
  let result = html;
  let prev = '';
  while (prev !== result) {
    prev = result;
    // Find outermost match
    let start = -1;
    let openCount = 0;
    let i = 0;
    const lower = result.toLowerCase();
    while (i < lower.length) {
      const nextOpen = lower.indexOf(`<${tag}`, i);
      const nextClose = lower.indexOf(`</${tag}>`, i);
      if (nextOpen === -1 && nextClose === -1) break;
      if (
        nextOpen !== -1 &&
        (nextClose === -1 || nextOpen < nextClose)
      ) {
        // Check it's actually a full open tag
        const tagEnd = lower.indexOf('>', nextOpen);
        if (tagEnd === -1) break;
        if (openCount === 0) start = nextOpen;
        openCount++;
        i = tagEnd + 1;
      } else {
        openCount--;
        if (openCount === 0 && start !== -1) {
          const end = nextClose + `</${tag}>`.length;
          result = result.slice(0, start) + result.slice(end);
          break;
        }
        i = nextClose + `</${tag}>`.length;
      }
    }
    if (prev === result) break;
  }
  // Also strip self-closing and lone open tags with no matching close
  result = result.replace(open, '');
  result = result.replace(close, '');
  return result;
}

/** Get attribute value from an HTML tag string */
function getAttr(tag: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*?)"|'([^']*?)'|([^\\s>]*))`, 'i');
  const m = tag.match(re);
  if (!m) return '';
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** Resolve a URL against a base */
function resolveUrl(href: string, baseUrl?: string): string {
  if (!baseUrl || !href) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

// ─── Main content extraction ──────────────────────────────────────────────────

export function extractMainContent(html: string): string {
  // Strip junk tags entirely
  let cleaned = stripComments(html);
  for (const tag of ['script', 'style', 'noscript', 'iframe', 'svg', 'form']) {
    cleaned = stripTagWithContent(cleaned, tag);
  }
  // Strip structural noise tags (keep content)
  for (const tag of ['nav', 'header', 'footer', 'aside']) {
    cleaned = cleaned.replace(
      new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
      '',
    );
  }

  // Prefer <main>, <article>, or [role=main]
  const mainMatch =
    cleaned.match(/<main(?:\s[^>]*)?>[\s\S]*?<\/main>/i) ??
    cleaned.match(/<article(?:\s[^>]*)?>[\s\S]*?<\/article>/i) ??
    cleaned.match(/<[^>]+role\s*=\s*["']?main["']?[^>]*>[\s\S]*?<\/[a-z]+>/i);

  return mainMatch ? mainMatch[0] : cleaned;
}

// ─── Title extraction ─────────────────────────────────────────────────────────

export function extractTitle(html: string): string | undefined {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const t = cleanText(titleTag[1]);
    if (t) return t;
  }
  const h1 = html.match(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/i);
  if (h1) {
    const t = cleanText(stripAllTags(h1[0]));
    if (t) return t;
  }
  return undefined;
}

// ─── Meta extraction ──────────────────────────────────────────────────────────

export function extractMeta(html: string): MetaInfo {
  const meta: MetaInfo = {};

  // <title>
  meta.title = extractTitle(html);

  // <meta name="description">
  const descMatch = html.match(
    /<meta\s[^>]*name\s*=\s*["']description["'][^>]*>/i,
  ) ?? html.match(/<meta\s[^>]*content\s*=\s*["'][^"']*["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
  if (descMatch) meta.description = cleanText(getAttr(descMatch[0], 'content'));

  // <meta name="author">
  const authorMatch = html.match(/<meta\s[^>]*name\s*=\s*["']author["'][^>]*>/i);
  if (authorMatch) meta.author = cleanText(getAttr(authorMatch[0], 'content'));

  // <link rel="canonical">
  const canonMatch = html.match(/<link\s[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  if (canonMatch) meta.canonical = getAttr(canonMatch[0], 'href');

  // <meta property="og:image">
  const ogImgMatch = html.match(/<meta\s[^>]*property\s*=\s*["']og:image["'][^>]*>/i)
    ?? html.match(/<meta\s[^>]*content\s*=\s*["'][^"']*["'][^>]*property\s*=\s*["']og:image["'][^>]*>/i);
  if (ogImgMatch) meta.ogImage = getAttr(ogImgMatch[0], 'content');

  return meta;
}

// ─── cleanText ────────────────────────────────────────────────────────────────

/** Strip all HTML tags from a string */
function stripAllTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export function cleanText(text: string): string {
  // Strip real HTML tags first, then decode entities (so &lt;tag&gt; → <tag>)
  let result = stripAllTags(text);
  result = decodeEntities(result);
  // Strip control characters (keep newline/tab)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse whitespace
  result = result.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

// ─── summarize ────────────────────────────────────────────────────────────────

export function summarize(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  // Try to cut at last sentence boundary (. ! ?)
  const lastSentence = truncated.search(/[.!?][^.!?]*$/);
  if (lastSentence > 0) {
    return truncated.slice(0, lastSentence + 1) + '…';
  }
  return truncated + '…';
}

// ─── Depth-aware list parser ──────────────────────────────────────────────────

/**
 * Find the position right after the closing </tag> that matches the opening
 * tag whose body starts at `afterOpen`.
 */
function findMatchingClose(
  html: string,
  tag: string,
  afterOpen: number,
): number {
  const lower = html.toLowerCase();
  const closeTag = `</${tag}>`;
  let depth = 1;
  let pos = afterOpen;

  while (depth > 0 && pos < lower.length) {
    const nextOpen = lower.indexOf(`<${tag}`, pos);
    const nextClose = lower.indexOf(closeTag, pos);

    if (nextClose === -1) return -1;

    let validOpen = false;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const c = lower[nextOpen + tag.length + 1];
      validOpen =
        c === '>' || c === ' ' || c === '\t' || c === '\n' || c === '\r';
    }

    if (validOpen && nextOpen < nextClose) {
      depth++;
      const tagEnd = lower.indexOf('>', nextOpen);
      pos = tagEnd === -1 ? lower.length : tagEnd + 1;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
      if (depth === 0) return pos;
    }
  }
  return -1;
}

/**
 * Walk `html`, convert all <ul>/<ol> lists with proper nesting depth.
 */
function processListsInHtml(
  html: string,
  baseUrl: string | undefined,
  preserveImages: boolean,
  depth: number,
): string {
  let result = '';
  let pos = 0;
  const lower = html.toLowerCase();

  while (pos < html.length) {
    const nextUl = lower.indexOf('<ul', pos);
    const nextOl = lower.indexOf('<ol', pos);

    if (nextUl === -1 && nextOl === -1) {
      result += html.slice(pos);
      break;
    }

    let nextList: number;
    let listTag: string;
    if (nextUl === -1) {
      nextList = nextOl;
      listTag = 'ol';
    } else if (nextOl === -1) {
      nextList = nextUl;
      listTag = 'ul';
    } else {
      nextList = Math.min(nextUl, nextOl);
      listTag = nextUl <= nextOl ? 'ul' : 'ol';
    }

    // Verify it's a proper tag (not <ulx)
    const c = lower[nextList + listTag.length + 1];
    if (c !== '>' && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      result += html.slice(pos, nextList + 1);
      pos = nextList + 1;
      continue;
    }

    result += html.slice(pos, nextList);

    const tagEnd = lower.indexOf('>', nextList);
    if (tagEnd === -1) {
      result += html.slice(nextList);
      break;
    }

    const afterOpen = tagEnd + 1;
    const closeEnd = findMatchingClose(html, listTag, afterOpen);
    if (closeEnd === -1) {
      result += html.slice(nextList);
      break;
    }

    const innerHtml = html.slice(afterOpen, closeEnd - `</${listTag}>`.length);
    const items = extractListItemsDP(innerHtml, baseUrl, preserveImages, depth);
    const indent = '  '.repeat(depth);

    if (listTag === 'ul') {
      result += '\n' + items.map((i) => `${indent}- ${i}`).join('\n') + '\n';
    } else {
      result +=
        '\n' +
        items.map((i, idx) => `${indent}${idx + 1}. ${i}`).join('\n') +
        '\n';
    }

    pos = closeEnd;
  }

  return result;
}

function extractListItemsDP(
  html: string,
  baseUrl: string | undefined,
  preserveImages: boolean,
  depth: number,
): string[] {
  const items: string[] = [];
  let pos = 0;
  const lower = html.toLowerCase();

  while (pos < html.length) {
    const nextLi = lower.indexOf('<li', pos);
    if (nextLi === -1) break;

    const c = lower[nextLi + 3];
    if (c !== '>' && c !== ' ' && c !== '\t' && c !== '\n') {
      pos = nextLi + 1;
      continue;
    }

    const tagEnd = lower.indexOf('>', nextLi);
    if (tagEnd === -1) break;

    const afterOpen = tagEnd + 1;
    const closeEnd = findMatchingClose(html, 'li', afterOpen);

    let inner: string;
    if (closeEnd === -1) {
      inner = html.slice(afterOpen);
      pos = html.length;
    } else {
      inner = html.slice(afterOpen, closeEnd - '</li>'.length);
      pos = closeEnd;
    }

    // Recursively process nested lists at depth+1
    const processed = processListsInHtml(inner, baseUrl, preserveImages, depth + 1);
    items.push(cleanInline(processed, baseUrl, preserveImages).trim());
  }

  return items;
}

// ─── HTML → Markdown ──────────────────────────────────────────────────────────

export function htmlToMarkdown(
  html: string,
  opts: HtmlToMarkdownOptions = {},
): string {
  const { baseUrl, maxLength, preserveImages = true } = opts;

  // 1. Strip comments and noise tags
  let work = stripComments(html);
  for (const tag of ['script', 'style', 'noscript', 'iframe', 'svg']) {
    work = stripTagWithContent(work, tag);
  }

  // 2. Convert block elements first (order matters)
  work = convertBlock(work, baseUrl, preserveImages);

  // 3. Strip remaining tags
  work = work.replace(/<[^>]+>/g, '');

  // 4. Decode entities and clean
  work = decodeEntities(work);

  // 5. Normalise whitespace: collapse multiple blank lines
  work = work.replace(/[ \t]+$/gm, '');
  work = work.replace(/\n{3,}/g, '\n\n').trim();

  // 6. maxLength — truncate at last paragraph break
  if (maxLength && work.length > maxLength) {
    const sub = work.slice(0, maxLength);
    const lastPara = sub.lastIndexOf('\n\n');
    if (lastPara > 0) {
      work = sub.slice(0, lastPara) + '\n\n…';
    } else {
      work = sub + '\n\n…';
    }
  }

  return work;
}

// ─── Block converter (recursive-ish via string replacement passes) ────────────

function convertBlock(
  html: string,
  baseUrl: string | undefined,
  preserveImages: boolean,
): string {
  let h = html;

  // Pre blocks (must come before inline <code>)
  h = h.replace(
    /<pre(?:\s[^>]*)?>[\s\S]*?<code((?:\s[^>]*)?)>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi,
    (_match, attrs, code) => {
      const langMatch = attrs.match(/class\s*=\s*["']?language-([a-z0-9-]+)/i);
      const lang = langMatch ? langMatch[1] : '';
      const decoded = decodeEntities(code).replace(/<[^>]+>/g, '');
      return `\n\`\`\`${lang}\n${decoded}\n\`\`\`\n`;
    },
  );
  // <pre> without nested code
  h = h.replace(/<pre(?:\s[^>]*)?>([^<]*)<\/pre>/gi, (_m, text) => {
    return `\n\`\`\`\n${decodeEntities(text)}\n\`\`\`\n`;
  });

  // Headings
  for (let level = 1; level <= 6; level++) {
    const prefix = '#'.repeat(level);
    h = h.replace(
      new RegExp(`<h${level}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/h${level}>`, 'gi'),
      (_m, inner) => `\n${prefix} ${cleanInline(inner)}\n`,
    );
  }

  // Blockquote
  h = h.replace(/<blockquote(?:\s[^>]*)?>[\s\S]*?<\/blockquote>/gi, (m) => {
    const inner = m.replace(/<\/?blockquote(?:\s[^>]*)?>/gi, '');
    const lines = convertBlock(inner, baseUrl, preserveImages)
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    return `\n${lines}\n`;
  });

  // Lists — use depth-aware parser
  h = processListsInHtml(h, baseUrl, preserveImages, 0);

  // Paragraphs
  h = h.replace(/<p(?:\s[^>]*)?>([^]*?)<\/p>/gi, (_m, inner) => {
    return `\n\n${cleanInline(inner, baseUrl, preserveImages)}\n\n`;
  });

  // <br>
  h = h.replace(/<br\s*\/?>/gi, '\n');

  // <hr>
  h = h.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Inline elements
  h = cleanInline(h, baseUrl, preserveImages);

  return h;
}

// ─── Inline converter ─────────────────────────────────────────────────────────

function cleanInline(
  html: string,
  baseUrl?: string,
  preserveImages = true,
): string {
  let h = html;

  // Images
  if (preserveImages) {
    h = h.replace(/<img(?:\s[^>]*)?\/?>/gi, (tag) => {
      const src = resolveUrl(getAttr(tag, 'src'), baseUrl);
      const alt = getAttr(tag, 'alt');
      return src ? `![${alt}](${src})` : '';
    });
  } else {
    h = h.replace(/<img(?:\s[^>]*)?\/?>/gi, '');
  }

  // Links
  h = h.replace(/<a(?:\s[^>]*)?>[\s\S]*?<\/a>/gi, (tag) => {
    const href = resolveUrl(getAttr(tag, 'href'), baseUrl);
    const inner = tag.replace(/<\/?a(?:\s[^>]*)?>/gi, '');
    const text = cleanText(stripAllTags(inner));
    if (!href) return text;
    return `[${text}](${href})`;
  });

  // Bold
  h = h.replace(/<(?:strong|b)(?:\s[^>]*)?>([^]*?)<\/(?:strong|b)>/gi,
    (_m, inner) => `**${cleanText(stripAllTags(inner))}**`);

  // Italic
  h = h.replace(/<(?:em|i)(?:\s[^>]*)?>([^]*?)<\/(?:em|i)>/gi,
    (_m, inner) => `*${cleanText(stripAllTags(inner))}*`);

  // Inline code (not pre>code)
  h = h.replace(/<code(?:\s[^>]*)?>([^]*?)<\/code>/gi,
    (_m, inner) => `\`${cleanText(stripAllTags(inner))}\``);

  return h;
}
