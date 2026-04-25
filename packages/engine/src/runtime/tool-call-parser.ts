/**
 * tool-call-parser.ts — Universal LLM tool-call parser for Pyrfor engine.
 *
 * Extracts structured tool calls from diverse LLM output formats:
 *   - Tagged <tool_call> (4 shapes: standard, unclosed, GLM-style, GLM-redundant)
 *   - Custom arg-key/arg-value XML inside <tool_call> (production bug fix)
 *   - Anthropic <function_call> and <tool_use> tags
 *   - OpenAI native tool_calls array (double-encoded arguments)
 *   - Bare JSON objects {"name":"X","args":{...}}
 *   - Plain text key:value lines (conservative fallback)
 *
 * Strategy pipeline tries formats in priority order, accumulating results.
 * Robust against malformed JSON (repairs unquoted keys, single quotes).
 * Pure TS, ESM-only, no external deps.
 */

import { logger } from '../observability/logger';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  /** Verbatim source slice that produced this call. */
  raw: string;
}

export interface ParseOptions {
  /** Optional callback fired for every failed parse attempt with diagnostic info. Default: logger.warn */
  onParseFailure?: (info: { strategy: string; rawPreview: string; error: string }) => void;
  /** Disable specific strategies (for testing isolation). */
  disableStrategies?: Array<
    'tagged' | 'arg-xml' | 'function-call-tag' | 'openai-native' | 'bare-object' | 'line-kv'
  >;
}

// ── Helper: balanced brace scanner ────────────────────────────────────────────

/**
 * Extract the first balanced `{...}` object from a string, ignoring text
 * after it. Returns null if no balanced object found.
 * String-aware: skips braces inside quoted strings.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ── Helper: safe JSON parse with repairs ──────────────────────────────────────

interface ParseJsonResult {
  success: boolean;
  data?: { name?: unknown; args?: unknown; arguments?: unknown; input?: unknown; parameters?: unknown };
  error?: string;
}

/**
 * Attempt JSON.parse with fallback repairs:
 *  - Unquoted keys: `foo:` → `"foo":`
 *  - Single quotes → double quotes
 * Returns success + data or error string.
 */
function tryParseJson(raw: string): ParseJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e1) {
    // First repair: unquoted keys and single quotes.
    const repaired = raw.replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
    try {
      parsed = JSON.parse(repaired);
    } catch (e2) {
      return { success: false, error: String(e2) };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Parsed value is not an object' };
  }
  return { success: true, data: parsed as { name?: unknown; args?: unknown; arguments?: unknown; input?: unknown; parameters?: unknown } };
}

/**
 * Extract name + args from a parsed object that has either `args` or `arguments` key.
 * Returns null if missing a valid name.
 */
function extractNameAndArgs(
  obj: { name?: unknown; args?: unknown; arguments?: unknown; input?: unknown; parameters?: unknown },
): { name: string; args: Record<string, unknown> } | null {
  const name = typeof obj.name === 'string' ? obj.name : '';
  // Accept multiple aliases for the args bag:
  //   args        — Pyrfor canonical (system prompt teaches this)
  //   arguments   — OpenAI native function-calling spec
  //   input       — Anthropic tool_use spec
  //   parameters  — older/alternative naming seen in some adapters
  const argsSrc = obj.args ?? obj.arguments ?? obj.input ?? obj.parameters ?? {};
  const args = argsSrc && typeof argsSrc === 'object' ? (argsSrc as Record<string, unknown>) : {};
  if (!name) return null;
  return { name, args };
}

// ── Strategy 1: Tagged <tool_call> (existing 4 shapes) ────────────────────────

const TOOL_CALL_OPEN_TAG_RE = /<tool_call(?=[\s=>])/gi;
const TOOL_CALL_CLOSE_TAG = '</tool_call>';

interface ParsedTagSpan {
  tagStart: number;
  spanEnd: number;
  body: string;
}

/**
 * Scan-based locator that handles every tool_call shape seen in the wild:
 *   1. `<tool_call>{json}</tool_call>`       — canonical (Qwen/DeepSeek)
 *   2. `<tool_call>{json}`                   — unclosed
 *   3. `<tool_call={json}>`                  — GLM-style (JSON in tag)
 *   4. `<tool_call={json}></tool_call>`      — GLM with redundant closer
 */
function locateToolCallSpans(text: string): ParsedTagSpan[] {
  const spans: ParsedTagSpan[] = [];
  TOOL_CALL_OPEN_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_CALL_OPEN_TAG_RE.exec(text)) !== null) {
    const tagStart = m.index;
    let i = m.index + m[0].length; // pointer just past "<tool_call"

    // Skip whitespace inside the tag.
    while (i < text.length && /\s/.test(text[i])) i++;

    let body = '';
    let spanEnd = i;

    if (text[i] === '=') {
      // GLM-style: <tool_call={json}>
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      const json = extractFirstJsonObject(text.slice(i));
      if (!json) {
        TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
        continue;
      }
      body = json;
      i += json.length;
      // Consume optional trailing chars up to and including `>`.
      while (i < text.length && text[i] !== '>') i++;
      if (text[i] === '>') i++;
      // Optional redundant `</tool_call>` immediately after.
      const tailRest = text.slice(i);
      const closeMatch = tailRest.match(/^\s*<\/tool_call>/i);
      if (closeMatch) i += closeMatch[0].length;
      spanEnd = i;
    } else if (text[i] === '>') {
      // Classic: <tool_call>...
      i++;
      const rest = text.slice(i);
      const closeIdx = rest.search(/<\/tool_call>/i);
      const nextOpenRe = /<tool_call(?=[\s=>])/i;
      const nextOpenMatch = rest.match(nextOpenRe);
      const nextOpenIdx = nextOpenMatch ? rest.indexOf(nextOpenMatch[0]) : -1;

      let endIdx: number;
      if (closeIdx >= 0 && (nextOpenIdx < 0 || closeIdx < nextOpenIdx)) {
        endIdx = closeIdx;
        body = rest.slice(0, endIdx);
        spanEnd = i + endIdx + TOOL_CALL_CLOSE_TAG.length;
      } else if (nextOpenIdx >= 0) {
        endIdx = nextOpenIdx;
        body = rest.slice(0, endIdx);
        spanEnd = i + endIdx;
      } else {
        body = rest;
        spanEnd = text.length;
      }
    } else {
      TOOL_CALL_OPEN_TAG_RE.lastIndex = i + 1;
      continue;
    }

    spans.push({ tagStart, spanEnd, body });
    TOOL_CALL_OPEN_TAG_RE.lastIndex = spanEnd;
  }
  return spans;
}

function tryParseToolBody(
  body: string,
): { name: string; args: Record<string, unknown> } | null {
  // Trim accidental closing tag fragments and trailing junk.
  let raw = body.replace(/<\/tool_call>\s*$/i, '').trim();
  // Strip a leading `=` (some models emit `<tool_call> ={...}`).
  raw = raw.replace(/^=+\s*/, '');
  // Sometimes the model wraps JSON in a ```json fence inside the tag.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!raw) return null;

  // Try to grab just the first balanced JSON object if there's noise around.
  const objMatch = extractFirstJsonObject(raw);
  if (objMatch) raw = objMatch;

  const result = tryParseJson(raw);
  if (!result.success || !result.data) return null;
  return extractNameAndArgs(result.data);
}

function strategyTagged(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];
  for (const span of locateToolCallSpans(text)) {
    const parsed = tryParseToolBody(span.body);
    if (parsed) {
      calls.push({ ...parsed, raw: text.slice(span.tagStart, span.spanEnd) });
      coveredRanges.push([span.tagStart, span.spanEnd]);
    } else {
      // Tag found but JSON parse failed — might be arg-xml format.
      // We'll let the arg-xml strategy handle it.
      opts.onParseFailure?.({
        strategy: 'tagged',
        rawPreview: span.body.slice(0, 200),
        error: 'JSON parse failed on tag body',
      });
    }
  }
  return { calls, coveredRanges };
}

// ── Strategy 2: Custom arg-key/arg-value XML ──────────────────────────────────

/**
 * Parses: `TOOL_NAME<arg_key>K1</arg_key><arg_value>V1</arg_value>...`
 * inside `<tool_call>...</tool_call>` wrapper or standalone.
 */
function strategyArgXml(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];

  // First, check inside <tool_call> tags where JSON parsing failed.
  const spans = locateToolCallSpans(text);
  for (const span of spans) {
    const body = span.body.trim();
    // Pattern: tool_name<arg_key>...</arg_key><arg_value>...</arg_value>
    const match = body.match(
      /^\s*([A-Za-z_][\w-]*)\s*((?:<arg_key>[\s\S]*?<\/arg_key>\s*<arg_value>[\s\S]*?<\/arg_value>\s*)+)/,
    );
    if (match) {
      const name = match[1];
      const argsSection = match[2];
      const args: Record<string, unknown> = {};

      // Extract all arg_key/arg_value pairs.
      const pairRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
      let pairMatch: RegExpExecArray | null;
      while ((pairMatch = pairRe.exec(argsSection)) !== null) {
        const key = pairMatch[1].trim();
        let value: unknown = pairMatch[2].trim();
        // Try to parse value as JSON if it looks like JSON.
        if (
          (value as string).startsWith('{') ||
          (value as string).startsWith('[') ||
          (value as string).startsWith('"')
        ) {
          try {
            value = JSON.parse(value as string);
          } catch {
            // Keep as string.
          }
        }
        args[key] = value;
      }

      if (name && Object.keys(args).length > 0) {
        calls.push({ name, args, raw: text.slice(span.tagStart, span.spanEnd) });
        coveredRanges.push([span.tagStart, span.spanEnd]);
      }
    }
  }

  // Also check for standalone arg-xml (not wrapped).
  const standaloneRe =
    /([A-Za-z_][\w-]*)\s*((?:<arg_key>[\s\S]*?<\/arg_key>\s*<arg_value>[\s\S]*?<\/arg_value>\s*)+)/g;
  let standaloneMatch: RegExpExecArray | null;
  while ((standaloneMatch = standaloneRe.exec(text)) !== null) {
    const start = standaloneMatch.index;
    const end = start + standaloneMatch[0].length;
    // Skip if already covered by a <tool_call> tag.
    if (coveredRanges.some(([s, e]) => start >= s && end <= e)) continue;

    const name = standaloneMatch[1];
    const argsSection = standaloneMatch[2];
    const args: Record<string, unknown> = {};

    const pairRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    let pairMatch: RegExpExecArray | null;
    while ((pairMatch = pairRe.exec(argsSection)) !== null) {
      const key = pairMatch[1].trim();
      let value: unknown = pairMatch[2].trim();
      if (
        (value as string).startsWith('{') ||
        (value as string).startsWith('[') ||
        (value as string).startsWith('"')
      ) {
        try {
          value = JSON.parse(value as string);
        } catch {
          // Keep as string.
        }
      }
      args[key] = value;
    }

    if (name && Object.keys(args).length > 0) {
      calls.push({ name, args, raw: standaloneMatch[0] });
      coveredRanges.push([start, end]);
    }
  }

  return { calls, coveredRanges };
}

// ── Strategy 3: Anthropic-style <function_call> and <tool_use> ────────────────

const FUNCTION_CALL_TAG_RE = /<(function_call|tool_use)(?=[\s>])/gi;

function strategyFunctionCallTag(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];

  FUNCTION_CALL_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNCTION_CALL_TAG_RE.exec(text)) !== null) {
    const tagName = m[1];
    const tagStart = m.index;
    let i = m.index + m[0].length;

    // Skip whitespace.
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '>') {
      FUNCTION_CALL_TAG_RE.lastIndex = i + 1;
      continue;
    }
    i++; // skip >

    // Find closing tag.
    const closePattern = new RegExp(`</${tagName}>`, 'i');
    const rest = text.slice(i);
    const closeMatch = rest.match(closePattern);
    let body: string;
    let spanEnd: number;

    if (closeMatch && closeMatch.index !== undefined) {
      body = rest.slice(0, closeMatch.index);
      spanEnd = i + closeMatch.index + closeMatch[0].length;
    } else {
      body = rest;
      spanEnd = text.length;
    }

    // Parse body as JSON.
    let raw = body.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) {
      FUNCTION_CALL_TAG_RE.lastIndex = spanEnd;
      continue;
    }

    const objMatch = extractFirstJsonObject(raw);
    if (objMatch) raw = objMatch;

    const result = tryParseJson(raw);
    if (result.success && result.data) {
      const parsed = extractNameAndArgs(result.data);
      if (parsed) {
        calls.push({ ...parsed, raw: text.slice(tagStart, spanEnd) });
        coveredRanges.push([tagStart, spanEnd]);
      }
    } else {
      opts.onParseFailure?.({
        strategy: 'function-call-tag',
        rawPreview: raw.slice(0, 200),
        error: result.error || 'Unknown parse error',
      });
    }

    FUNCTION_CALL_TAG_RE.lastIndex = spanEnd;
  }

  return { calls, coveredRanges };
}

// ── Strategy 4: OpenAI native tool_calls array ────────────────────────────────

function strategyOpenAINative(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];

  // Look for a top-level JSON object/array with `tool_calls` key.
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { calls, coveredRanges };
  }

  const objMatch = extractFirstJsonObject(trimmed);
  if (!objMatch) return { calls, coveredRanges };

  const result = tryParseJson(objMatch);
  if (!result.success || !result.data) return { calls, coveredRanges };

  const data = result.data as Record<string, unknown>;
  if (!Array.isArray(data.tool_calls)) return { calls, coveredRanges };

  const start = trimmed.indexOf(objMatch);
  const end = start + objMatch.length;

  for (const item of data.tool_calls) {
    if (typeof item !== 'object' || !item) continue;
    const tc = item as { type?: unknown; function?: unknown };
    if (tc.type !== 'function') continue;
    if (typeof tc.function !== 'object' || !tc.function) continue;
    const fn = tc.function as { name?: unknown; arguments?: unknown };
    const name = typeof fn.name === 'string' ? fn.name : '';
    const argsStr = typeof fn.arguments === 'string' ? fn.arguments : '{}';
    // arguments is double-encoded JSON per OpenAI spec.
    const argsResult = tryParseJson(argsStr);
    if (!argsResult.success || !argsResult.data) continue;
    const args =
      argsResult.data && typeof argsResult.data === 'object'
        ? (argsResult.data as Record<string, unknown>)
        : {};
    if (name) {
      calls.push({ name, args, raw: objMatch });
    }
  }

  if (calls.length > 0) {
    coveredRanges.push([start, end]);
  }

  return { calls, coveredRanges };
}

// ── Strategy 5: Bare named-object ──────────────────────────────────────────────

function strategyBareObject(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];

  // Look for ```json fenced blocks.
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(text)) !== null) {
    const content = fenceMatch[1].trim();
    const objMatch = extractFirstJsonObject(content);
    if (!objMatch) continue;

    const result = tryParseJson(objMatch);
    if (result.success && result.data) {
      const parsed = extractNameAndArgs(result.data);
      if (parsed) {
        const start = fenceMatch.index;
        const end = start + fenceMatch[0].length;
        calls.push({ ...parsed, raw: fenceMatch[0] });
        coveredRanges.push([start, end]);
      }
    }
  }

  // Also look for bare JSON objects not in fences.
  // Use a more careful approach: find all '{' and try to extract balanced objects.
  let searchStart = 0;
  while (searchStart < text.length) {
    const nextBrace = text.indexOf('{', searchStart);
    if (nextBrace < 0) break;

    // Skip if already covered.
    if (coveredRanges.some(([s, e]) => nextBrace >= s && nextBrace < e)) {
      searchStart = nextBrace + 1;
      continue;
    }

    const objMatch = extractFirstJsonObject(text.slice(nextBrace));
    if (!objMatch) {
      searchStart = nextBrace + 1;
      continue;
    }

    const result = tryParseJson(objMatch);
    if (result.success && result.data) {
      const parsed = extractNameAndArgs(result.data);
      if (parsed) {
        const start = nextBrace;
        const end = start + objMatch.length;
        calls.push({ ...parsed, raw: objMatch });
        coveredRanges.push([start, end]);
        searchStart = end;
        continue;
      }
    }

    searchStart = nextBrace + 1;
  }

  return { calls, coveredRanges };
}

// ── Strategy 6: Plain text key:value lines ────────────────────────────────────

function strategyLineKV(
  text: string,
  opts: ParseOptions,
): { calls: ParsedToolCall[]; coveredRanges: Array<[number, number]> } {
  const calls: ParsedToolCall[] = [];
  const coveredRanges: Array<[number, number]> = [];

  // Conservative: only activate if message is short, starts with identifier, has key:value lines.
  if (text.length > 500) return { calls, coveredRanges };

  const lines = text.split('\n');
  if (lines.length < 2) return { calls, coveredRanges };

  const firstLine = lines[0].trim();
  // First line must be a single identifier (tool name).
  if (!/^[A-Za-z_][\w-]*$/.test(firstLine)) return { calls, coveredRanges };

  const args: Record<string, unknown> = {};
  let validPairs = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key || !value) continue;
    args[key] = value;
    validPairs++;
  }

  if (validPairs > 0) {
    calls.push({ name: firstLine, args, raw: text });
    coveredRanges.push([0, text.length]);
  }

  return { calls, coveredRanges };
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseToolCalls(text: string, opts: ParseOptions = {}): ParsedToolCall[] {
  const onParseFailure =
    opts.onParseFailure ||
    ((info) => {
      logger.warn('Failed to parse tool_call', {
        strategy: info.strategy,
        rawPreview: info.rawPreview,
        error: info.error,
      });
    });

  const disabled = new Set(opts.disableStrategies || []);
  const allCalls: ParsedToolCall[] = [];
  const allCoveredRanges: Array<[number, number]> = [];

  // Strategy 1: Tagged <tool_call>.
  if (!disabled.has('tagged')) {
    const { calls, coveredRanges } = strategyTagged(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Strategy 2: arg-xml.
  if (!disabled.has('arg-xml')) {
    const { calls, coveredRanges } = strategyArgXml(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Strategy 3: <function_call> and <tool_use>.
  if (!disabled.has('function-call-tag')) {
    const { calls, coveredRanges } = strategyFunctionCallTag(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Strategy 4: OpenAI native.
  if (!disabled.has('openai-native')) {
    const { calls, coveredRanges } = strategyOpenAINative(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Strategy 5: Bare object (only if no calls found yet).
  if (!disabled.has('bare-object') && allCalls.length === 0) {
    const { calls, coveredRanges } = strategyBareObject(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Strategy 6: Line key:value (only if no calls found yet).
  if (!disabled.has('line-kv') && allCalls.length === 0) {
    const { calls, coveredRanges } = strategyLineKV(text, { ...opts, onParseFailure });
    allCalls.push(...calls);
    allCoveredRanges.push(...coveredRanges);
  }

  // Sort by source order (by start position in text).
  allCalls.sort((a, b) => {
    const aIdx = text.indexOf(a.raw);
    const bIdx = text.indexOf(b.raw);
    return aIdx - bIdx;
  });

  return allCalls;
}

// ── Strip tool calls ──────────────────────────────────────────────────────────

export function stripToolCalls(text: string): string {
  // Collect all tag spans to remove.
  const spans: Array<[number, number]> = [];

  // 1. <tool_call> tags.
  for (const span of locateToolCallSpans(text)) {
    spans.push([span.tagStart, span.spanEnd]);
  }

  // 2. <function_call> and <tool_use> tags.
  FUNCTION_CALL_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNCTION_CALL_TAG_RE.exec(text)) !== null) {
    const tagName = m[1];
    const tagStart = m.index;
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '>') continue;
    i++;
    const closePattern = new RegExp(`</${tagName}>`, 'i');
    const rest = text.slice(i);
    const closeMatch = rest.match(closePattern);
    const spanEnd = closeMatch && closeMatch.index !== undefined
      ? i + closeMatch.index + closeMatch[0].length
      : text.length;
    spans.push([tagStart, spanEnd]);
    FUNCTION_CALL_TAG_RE.lastIndex = spanEnd;
  }

  // 3. arg-xml standalone.
  const argXmlRe =
    /([A-Za-z_][\w-]*)\s*((?:<arg_key>[\s\S]*?<\/arg_key>\s*<arg_value>[\s\S]*?<\/arg_value>\s*)+)/g;
  let argXmlMatch: RegExpExecArray | null;
  while ((argXmlMatch = argXmlRe.exec(text)) !== null) {
    const start = argXmlMatch.index;
    const end = start + argXmlMatch[0].length;
    spans.push([start, end]);
  }

  if (spans.length === 0) {
    // Even with no parsed spans, drop a stray unclosed `<tool_call` tail.
    return text.replace(/<tool_call[\s\S]*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Sort spans and merge overlapping.
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1];
    const cur = spans[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }

  // Build output by skipping covered ranges.
  let out = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start);
    cursor = end;
  }
  out += text.slice(cursor);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
