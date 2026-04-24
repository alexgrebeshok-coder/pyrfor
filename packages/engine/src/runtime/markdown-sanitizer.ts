/**
 * Telegram-safe markdown sanitizer + chunker.
 * Prevents parse_mode 400 errors when forwarding LLM output to Telegram.
 */

export type SanitizeOpts = {
  mode: 'markdownv2' | 'html' | 'plain';
  preserveCodeBlocks?: boolean;
  maxLen?: number;
  chunkSeparator?: string;
};

export type SanitizeResult = {
  mode: SanitizeOpts['mode'];
  chunks: string[];
  truncated: boolean;
};

// Telegram MarkdownV2 special characters that must be escaped outside code/pre blocks.
const MDV2_SPECIAL = /[_*[\]()~`>#+=|{}.!\\\-]/g;

/**
 * Escape all Telegram MarkdownV2 special characters in plain text.
 * Does NOT double-escape already-escaped sequences.
 */
export function escapeMarkdownV2(text: string): string {
  // Escape each special char with a preceding backslash.
  // We process char by char to avoid double-escaping backslashes.
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      // Already an escape — pass through the backslash and the next char verbatim.
      result += '\\\\';
    } else if (/[_*[\]()~`>#+=|{}.!\-]/.test(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Escape HTML special characters outside safe blocks.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split text into segments: { type: 'text'|'fence', content: string, lang?: string }
 * Fenced code blocks are ``` ... ``` (possibly with language tag).
 */
type Segment = { type: 'text'; content: string } | { type: 'fence'; lang: string; content: string; raw: string };

function splitByFences(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match ``` optionally followed by lang tag on the same line, then content, then closing ```
  const fenceRe = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'fence', lang: match[1].trim(), content: match[2], raw: match[0] });
    lastIndex = fenceRe.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Mode-specific sanitizers
// ---------------------------------------------------------------------------

function sanitizeMarkdownV2(text: string): string {
  const segments = splitByFences(text);
  let out = '';
  for (const seg of segments) {
    if (seg.type === 'fence') {
      // Preserve the fence verbatim — Telegram parses ``` blocks without escaping inside.
      out += seg.raw;
    } else {
      // Replace orphan single backticks with escaped form, then escape everything else.
      const processed = seg.content.replace(/`/g, '\\`');
      out += escapeMarkdownV2(processed).replace(/\\\\`/g, '\\`'); // fix: backtick was already escaped above
    }
  }
  return out;
}

/**
 * Allowed HTML tags for Telegram HTML parse mode.
 */
const ALLOWED_HTML_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a']);

function sanitizeHtml(text: string): string {
  // First escape bare & < > that are NOT part of existing tags.
  // Strategy: split on tags, escape non-tag parts.
  const tagRe = /<[^>]*>/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(text)) !== null) {
    // Escape text before this tag
    if (match.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, match.index));
    }
    // Decide whether to keep or strip this tag
    const raw = match[0];
    const tagMatch = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch) {
      const tagName = tagMatch[1].toLowerCase();
      if (ALLOWED_HTML_TAGS.has(tagName)) {
        result += raw;
      }
      // else: strip — emit nothing
    }
    lastIndex = tagRe.lastIndex;
  }
  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex));
  }
  return result;
}

function sanitizePlain(text: string): string {
  let result = text;
  // Strip fenced code block markers (keep content)
  result = result.replace(/```[^\n`]*\n?([\s\S]*?)```/g, '$1');
  // Strip inline code backticks
  result = result.replace(/`([^`]*)`/g, '$1');
  // Strip bold/italic markers: ** __ * _
  result = result.replace(/\*\*([^*]*)\*\*/g, '$1');
  result = result.replace(/__([^_]*)__/g, '$1');
  result = result.replace(/\*([^*]*)\*/g, '$1');
  result = result.replace(/_([^_]*)_/g, '$1');
  // Strip strikethrough ~~
  result = result.replace(/~~([^~]*)~~/g, '$1');
  // Strip ATX headings (# ## ### etc.)
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Strip Telegram-specific ~ (spoiler)
  result = result.replace(/~([^~]*)~/g, '$1');
  // Collapse 3+ newlines to 2
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

// ---------------------------------------------------------------------------
// Chunker
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LEN = 4000;

/**
 * Split `text` into chunks of at most `maxLen` characters.
 * Preference order for break points: paragraph → sentence → word → hard cut.
 * Never breaks inside a fenced code block — splits before the fence and re-fences if needed.
 */
function chunkText(text: string, maxLen: number): string[] {
  if (maxLen <= 0) return [''];
  if (text.length === 0) return [''];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];

  function addChunk(s: string) {
    chunks.push(s);
  }

  // We process the text iteratively, keeping track of open fences.
  let remaining = text;
  let openFenceLang: string | null = null; // non-null when we're inside a re-opened fence

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      // Close open fence if needed
      const chunk = openFenceLang !== null ? remaining + '\n```' : remaining;
      // If closing pushed us over limit, we'll just accept it (edge case)
      addChunk(chunk);
      openFenceLang = null;
      break;
    }

    const window = remaining.slice(0, maxLen);
    const rest = remaining.slice(maxLen);

    // Check if there's a fenced code block that starts within our window.
    // If so, we must not break inside it.
    const fenceStartRe = /```/g;
    let fenceOpens: number[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = fenceStartRe.exec(window)) !== null) {
      fenceOpens.push(fm.index);
    }

    // Determine if we're currently mid-fence (openFenceLang !== null already handled by prepending)
    // and whether the window contains an unmatched opening fence.
    //
    // Simple approach: scan for fence delimiters linearly.
    let insideFence = openFenceLang !== null;
    let firstUnmatchedFenceStart = -1;

    for (const pos of fenceOpens) {
      if (!insideFence) {
        insideFence = true;
        firstUnmatchedFenceStart = pos;
      } else {
        insideFence = false;
        firstUnmatchedFenceStart = -1;
      }
    }

    if (insideFence && firstUnmatchedFenceStart !== -1) {
      // We have an open fence within our window — split BEFORE the fence start.
      const splitPos = firstUnmatchedFenceStart;
      if (splitPos === 0) {
        // The fence is at the very beginning; we need to include at least some of the code block.
        // Find the closing ``` in the full remaining text.
        const closingIdx = remaining.indexOf('```', 3);
        if (closingIdx === -1 || closingIdx + 3 > maxLen) {
          // Code block extends beyond maxLen — split at a line boundary within it.
          // Find the lang line first: skip past opening ``` and lang tag.
          const afterOpen = remaining.indexOf('\n') + 1;
          // Find best line break within maxLen - 4 (leave room for closing ```)
          const budget = maxLen - 4; // "```\n"
          let lineBreak = remaining.lastIndexOf('\n', budget);
          if (lineBreak <= afterOpen) lineBreak = budget; // hard cut
          const fenceChunk = remaining.slice(0, lineBreak) + '\n```';
          // Reopen: extract lang from opening fence
          const langMatch = remaining.match(/^```([^\n`]*)/);
          const lang = langMatch ? langMatch[1] : '';
          openFenceLang = lang;
          addChunk(fenceChunk);
          remaining = '```' + lang + '\n' + remaining.slice(lineBreak + 1);
          continue;
        }
        // Closing fence fits within window — take the whole fence as one chunk
        const fenceEnd = closingIdx + 3;
        const fenceBlock = remaining.slice(0, fenceEnd);
        // Find a break point after the fence
        const afterFence = remaining.slice(fenceEnd);
        addChunk(fenceBlock);
        remaining = afterFence;
        openFenceLang = null;
        continue;
      }
      // Split before the fence
      const before = remaining.slice(0, splitPos);
      // Try paragraph break in 'before'
      const breakPos = findBreakPoint(before, before.length);
      const chunk = remaining.slice(0, breakPos);
      addChunk(chunk);
      remaining = remaining.slice(breakPos).replace(/^\n+/, '');
      openFenceLang = null;
      continue;
    }

    // No unmatched fence in window — find a natural break point.
    const breakPos = findBreakPoint(remaining, maxLen);
    const chunk = openFenceLang !== null
      ? '```' + openFenceLang + '\n' + remaining.slice(0, breakPos) + '\n```'
      : remaining.slice(0, breakPos);
    addChunk(chunk);
    remaining = remaining.slice(breakPos).replace(/^\n+/, '');
    openFenceLang = null;
  }

  return chunks.length > 0 ? chunks : [''];
}

/**
 * Find the best break position ≤ maxLen within `text`.
 * Priority: paragraph → sentence → word → hard cut.
 */
function findBreakPoint(text: string, maxLen: number): number {
  const window = text.slice(0, maxLen);

  // Paragraph break (\n\n)
  const paraIdx = window.lastIndexOf('\n\n');
  if (paraIdx > 0) return paraIdx + 2;

  // Sentence break (. followed by space or newline)
  const sentIdx = window.search(/(?<=\. )(?=\S)|(?<=\.\n)/);
  // Use lastIndexOf approach for sentence
  let bestSent = -1;
  const sentRe = /\. /g;
  let sm: RegExpExecArray | null;
  while ((sm = sentRe.exec(window)) !== null) {
    bestSent = sm.index + 2;
  }
  if (bestSent > 0) return bestSent;

  // Word break (space)
  const spaceIdx = window.lastIndexOf(' ');
  if (spaceIdx > 0) return spaceIdx + 1;

  // Hard cut
  return maxLen;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function sanitize(text: string, opts: SanitizeOpts): SanitizeResult {
  const maxLen = opts.maxLen !== undefined ? opts.maxLen : DEFAULT_MAX_LEN;
  const { mode } = opts;

  let processed: string;
  switch (mode) {
    case 'markdownv2':
      processed = sanitizeMarkdownV2(text);
      break;
    case 'html':
      processed = sanitizeHtml(text);
      break;
    case 'plain':
      processed = sanitizePlain(text);
      break;
  }

  if (maxLen <= 0) {
    return { mode, chunks: [''], truncated: true };
  }

  const chunks = chunkText(processed, maxLen);
  const truncated = chunks.length > 1;

  return { mode, chunks, truncated };
}
