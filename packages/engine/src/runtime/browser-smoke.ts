import { createHash } from 'node:crypto';
import {
  createBrowserController,
  type BrowserController,
  type BrowserLauncher,
} from './browser-control';

const URL_MAX_LENGTH = 2048;
const SELECTOR_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 200;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export interface BrowserSmokeAssertionInput {
  selector?: string;
  containsText?: string;
}

export interface BrowserSmokeInput {
  url: string;
  assertion?: BrowserSmokeAssertionInput;
  fullPage?: boolean;
  approvalId?: string;
  notes?: string[];
}

export interface NormalizedBrowserSmokeInput {
  url: string;
  publicUrl: string;
  host: string;
  path: string;
  urlHash: string;
  fullPage: boolean;
  assertion?: {
    selector?: string;
    containsText?: string;
    containsTextHash?: string;
  };
  assertionHash: string;
  notes: string[];
}

export interface BrowserSmokeEffect {
  kind: 'browser_smoke';
  approvalId: string;
  executedAt: string;
  targetUrlHash: string;
  finalUrlHash: string;
}

export interface BrowserSmokeSnapshot {
  schemaVersion: 'pyrfor.browser_smoke.v1';
  createdAt: string;
  runId: string;
  status: 'passed' | 'failed';
  sourceMode: 'governed_browser_smoke';
  targetUrlHash: string;
  targetHost: string;
  targetPathHash: string;
  finalHost: string;
  finalUrlHash: string;
  title: string;
  assertion?: {
    selector?: string;
    containsTextHash?: string;
    matched: boolean;
  };
  screenshot: {
    artifactId: string;
    sha256?: string;
    bytes?: number;
    createdAt?: string;
  };
  effectsExecuted: [BrowserSmokeEffect];
  notes: string[];
}

export interface BrowserSmokeCaptureResult {
  normalized: NormalizedBrowserSmokeInput;
  snapshot: Omit<BrowserSmokeSnapshot, 'screenshot'>;
  screenshot: Buffer;
}

export interface RunBrowserSmokeCaptureOptions {
  launcher?: BrowserLauncher;
  controller?: BrowserController;
  now?: () => Date;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`BrowserSmoke: text exceeds ${maxLength} characters`);
  return trimmed;
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function redactText(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=[redacted]`)
    .slice(0, 300);
}

function normalizeLocalBrowserUrl(value: unknown): { url: string; publicUrl: string; host: string; path: string; urlHash: string } {
  const raw = cleanText(value, URL_MAX_LENGTH);
  if (!raw) throw new Error('BrowserSmoke: url is required');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('BrowserSmoke: url must be an absolute local http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('BrowserSmoke: url must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('BrowserSmoke: url must not contain embedded credentials');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('BrowserSmoke: only localhost, 127.0.0.1 or ::1 targets are allowed');
  }
  parsed.hash = '';
  const normalized = parsed.toString();
  const publicParsed = new URL(normalized);
  for (const key of Array.from(publicParsed.searchParams.keys())) {
    if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) {
      publicParsed.searchParams.set(key, 'redacted');
    }
  }
  return {
    url: normalized,
    publicUrl: publicParsed.toString(),
    host: parsed.host,
    path: parsed.pathname || '/',
    urlHash: hashText(normalized),
  };
}

export function normalizeBrowserSmokeInput(input: BrowserSmokeInput): NormalizedBrowserSmokeInput {
  const url = normalizeLocalBrowserUrl(input.url);
  const selector = cleanText(input.assertion?.selector, SELECTOR_MAX_LENGTH);
  const containsText = cleanText(input.assertion?.containsText, TEXT_MAX_LENGTH);
  const fullPage = input.fullPage === true;
  const assertionPayload = JSON.stringify({
    selector: selector ?? null,
    containsTextHash: containsText ? hashText(containsText) : null,
  });
  return {
    ...url,
    fullPage,
    ...(selector || containsText ? {
      assertion: {
        ...(selector ? { selector } : {}),
        ...(containsText ? { containsText, containsTextHash: hashText(containsText) } : {}),
      },
    } : {}),
    assertionHash: hashText(assertionPayload),
    notes: (Array.isArray(input.notes) ? input.notes : [])
      .map((note) => cleanText(note, TEXT_MAX_LENGTH))
      .filter((note): note is string => Boolean(note))
      .slice(0, 10),
  };
}

export function buildBrowserSmokeApprovalId(input: NormalizedBrowserSmokeInput, runId: string): string {
  const digest = createHash('sha256')
    .update(`${runId}:${input.urlHash}:${input.assertionHash}:${input.fullPage ? 'full' : 'viewport'}`)
    .digest('hex')
    .slice(0, 24);
  return `browser-smoke:${digest}`;
}

export async function runBrowserSmokeCapture(
  runId: string,
  input: BrowserSmokeInput & { approvalId: string },
  options: RunBrowserSmokeCaptureOptions = {},
): Promise<BrowserSmokeCaptureResult> {
  const normalized = normalizeBrowserSmokeInput(input);
  const approvalId = cleanText(input.approvalId, 200);
  if (!approvalId) throw new Error('BrowserSmoke: approvalId is required');
  const controller = options.controller ?? createBrowserController({
    launcher: options.launcher,
    defaultLaunchOpts: {
      kind: 'chromium',
      headless: true,
      actionTimeoutMs: 15_000,
      navTimeoutMs: 15_000,
      allowedHosts: [normalized.host],
    },
  });
  const executedAt = (options.now ?? (() => new Date()))().toISOString();
  await controller.launch({ kind: 'chromium', headless: true });
  try {
    const navigation = await controller.navigate(normalized.url);
    if (!navigation.ok || !navigation.data) {
      throw new Error(`BrowserSmoke: navigate failed: ${navigation.error ?? 'unknown error'}`);
    }
    const final = normalizeLocalBrowserUrl(navigation.data.url);
    let assertionMatched = true;
    if (normalized.assertion?.selector) {
      const text = await controller.getText(normalized.assertion.selector);
      if (!text.ok) throw new Error(`BrowserSmoke: assertion selector failed: ${text.error ?? 'unknown error'}`);
      if (normalized.assertion.containsText) {
        assertionMatched = (text.data ?? '').includes(normalized.assertion.containsText);
      }
    }
    const screenshot = await controller.screenshot({ fullPage: normalized.fullPage });
    if (!screenshot.ok || !screenshot.data) {
      throw new Error(`BrowserSmoke: screenshot failed: ${screenshot.error ?? 'unknown error'}`);
    }
    const snapshot: Omit<BrowserSmokeSnapshot, 'screenshot'> = {
      schemaVersion: 'pyrfor.browser_smoke.v1',
      createdAt: executedAt,
      runId,
      status: assertionMatched ? 'passed' : 'failed',
      sourceMode: 'governed_browser_smoke',
      targetUrlHash: normalized.urlHash,
      targetHost: normalized.host,
      targetPathHash: hashText(normalized.path),
      finalHost: final.host,
      finalUrlHash: final.urlHash,
      title: redactText(navigation.data.title),
      ...(normalized.assertion ? {
        assertion: {
          ...(normalized.assertion.selector ? { selector: redactText(normalized.assertion.selector) } : {}),
          ...(normalized.assertion.containsTextHash ? { containsTextHash: normalized.assertion.containsTextHash } : {}),
          matched: assertionMatched,
        },
      } : {}),
      effectsExecuted: [{
        kind: 'browser_smoke',
        approvalId,
        executedAt,
        targetUrlHash: normalized.urlHash,
        finalUrlHash: final.urlHash,
      }],
      notes: normalized.notes.map(redactText),
    };
    return {
      normalized,
      snapshot,
      screenshot: Buffer.from(screenshot.data),
    };
  } finally {
    await controller.close();
  }
}
