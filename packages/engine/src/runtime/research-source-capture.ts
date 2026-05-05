import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';

const URL_MAX_LENGTH = 2048;
const NOTE_MAX_LENGTH = 300;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 200_000;
const MAX_CAPTURE_CHARS = 40_000;
const MAX_EXCERPT_CHARS = 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export interface ResearchSourceCaptureInput {
  url: string;
  approvalId?: string;
  note?: string;
}

export interface NormalizedResearchSourceCaptureInput {
  url: string;
  publicUrl: string;
  urlHash: string;
  host: string;
  pathHash: string;
  note?: string;
}

export interface ResearchSourceCaptureSnapshot {
  schemaVersion: 'pyrfor.research_source_capture.v1';
  createdAt: string;
  runId: string;
  sourceMode: 'governed_source_capture';
  requestedUrl: string;
  requestedUrlHash: string;
  requestedHost: string;
  requestedPathHash: string;
  finalUrl: string;
  finalUrlHash: string;
  finalHost: string;
  statusCode: number;
  contentType: string;
  title?: string;
  contentHash: string;
  capturedBytes: number;
  truncated: boolean;
  excerpt: string;
  note?: string;
  effectsExecuted: [{
    kind: 'research_source_capture';
    approvalId: string;
    executedAt: string;
    requestedUrlHash: string;
    finalUrlHash: string;
  }];
}

export interface ResearchSourceCaptureArtifactDocument {
  snapshot: ResearchSourceCaptureSnapshot;
  contentText: string;
}

export interface ResearchSourceCaptureResult {
  normalized: NormalizedResearchSourceCaptureInput;
  snapshot: ResearchSourceCaptureSnapshot;
  artifactDocument: ResearchSourceCaptureArtifactDocument;
}

type ResolveHostname = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`ResearchSourceCapture: text exceeds ${maxLength} characters`);
  return trimmed;
}

function hashText(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts as [number, number, number, number];
}

function parseIpv4MappedIpv6(hostname: string): [number, number, number, number] | null {
  if (!hostname.startsWith('::ffff:')) return null;
  const suffix = hostname.slice('::ffff:'.length);
  const dotted = parseIpv4(suffix);
  if (dotted) return dotted;
  const hextets = suffix.split(':');
  if (hextets.length !== 2) return null;
  const high = Number.parseInt(hextets[0]!, 16);
  const low = Number.parseInt(hextets[1]!, 16);
  if (
    hextets.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) ||
    !Number.isInteger(high) ||
    !Number.isInteger(low)
  ) return null;
  return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  const ipv4 = parseIpv4(lower);
  if (ipv4) return isPrivateIpv4(ipv4);
  const ipv4Mapped = parseIpv4MappedIpv6(lower);
  if (ipv4Mapped) return isPrivateIpv4(ipv4Mapped);
  if (!lower.includes(':')) return false;
  if (lower === '::' || lower === '::1') return true;
  const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);
  if (!Number.isInteger(firstHextet)) return false;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  return false;
}

function publicUrl(parsed: URL): string {
  const clone = new URL(parsed.toString());
  for (const key of Array.from(clone.searchParams.keys())) {
    if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) clone.searchParams.set(key, 'redacted');
  }
  clone.pathname = clone.pathname === '/' ? '/' : '/redacted-path';
  clone.username = '';
  clone.password = '';
  clone.hash = '';
  return clone.toString();
}

async function defaultResolveHostname(hostname: string): ReturnType<ResolveHostname> {
  return dnsLookup(hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: false });
}

async function assertResolvedPublicTarget(
  input: NormalizedResearchSourceCaptureInput,
  resolveHostname: ResolveHostname,
): Promise<void> {
  const parsed = new URL(input.url);
  const addresses = await resolveHostname(parsed.hostname);
  if (addresses.length === 0) {
    throw new Error('ResearchSourceCapture: hostname did not resolve');
  }
  if (addresses.some((entry) => isPrivateHostname(entry.address))) {
    throw new Error('ResearchSourceCapture: DNS resolved to a local or private-network target');
  }
}

export function normalizeResearchSourceCaptureInput(input: ResearchSourceCaptureInput): NormalizedResearchSourceCaptureInput {
  const rawUrl = cleanText(input.url, URL_MAX_LENGTH);
  if (!rawUrl) throw new Error('ResearchSourceCapture: url is required');
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('ResearchSourceCapture: url must be absolute');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('ResearchSourceCapture: url must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('ResearchSourceCapture: url must not contain embedded credentials');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('ResearchSourceCapture: local and private-network targets are not allowed');
  }
  parsed.hash = '';
  const url = parsed.toString();
  const note = cleanText(input.note, NOTE_MAX_LENGTH);
  return {
    url,
    publicUrl: publicUrl(parsed),
    urlHash: hashText(url),
    host: parsed.host,
    pathHash: hashText(parsed.pathname || '/'),
    ...(note ? { note: sanitizeText(note).slice(0, NOTE_MAX_LENGTH) } : {}),
  };
}

export function buildResearchSourceCaptureApprovalId(input: NormalizedResearchSourceCaptureInput, runId: string): string {
  return `research-source:${hashText(`${runId}:${input.urlHash}`).slice(0, 24)}`;
}

function sanitizeText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=[redacted]`)
    .replace(/\s+/g, ' ')
    .trim();
}

function assertTextContentType(contentType: string): void {
  const normalized = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized !== 'text/html' && normalized !== 'text/plain') {
    throw new Error('ResearchSourceCapture: only text/html and text/plain responses are supported');
  }
}

function nextRedirectUrl(currentUrl: string, response: Response): string | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.get('location');
  if (!location) throw new Error('ResearchSourceCapture: redirect missing location');
  return new URL(location, currentUrl).toString();
}

async function readTextLimited(response: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    throw new Error('ResearchSourceCapture: response exceeds maximum size');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_BYTES) throw new Error('ResearchSourceCapture: response exceeds maximum size');
    return { text, bytes, truncated: text.length > MAX_CAPTURE_CHARS };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('ResearchSourceCapture: response exceeds maximum size');
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return { text, bytes: buffer.length, truncated: text.length > MAX_CAPTURE_CHARS };
}

export async function runResearchSourceCapture(
  runId: string,
  input: ResearchSourceCaptureInput & { approvalId: string },
  opts: {
    fetchImpl?: typeof fetch;
    resolveHostname?: ResolveHostname;
    timeoutMs?: number;
    now?: () => Date;
  } = {},
): Promise<ResearchSourceCaptureResult> {
  const normalized = normalizeResearchSourceCaptureInput(input);
  const approvalId = cleanText(input.approvalId, 200);
  if (!approvalId) throw new Error('ResearchSourceCapture: approvalId is required');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const resolveHostname = opts.resolveHostname ?? defaultResolveHostname;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = normalized.url;
  let response: Response | null = null;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const currentNormalized = normalizeResearchSourceCaptureInput({ url: current });
    await assertResolvedPublicTarget(currentNormalized, resolveHostname);
    response = await fetchImpl(currentNormalized.url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,text/plain;q=0.9' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const redirected = nextRedirectUrl(currentNormalized.url, response);
    if (!redirected) break;
    if (redirect === MAX_REDIRECTS) {
      throw new Error('ResearchSourceCapture: too many redirects');
    }
    current = normalizeResearchSourceCaptureInput({ url: redirected }).url;
  }
  if (!response) throw new Error('ResearchSourceCapture: request failed');
  const final = normalizeResearchSourceCaptureInput({ url: current });
  if (!response.ok) throw new Error(`ResearchSourceCapture: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  assertTextContentType(contentType);
  const read = await readTextLimited(response);
  const contentText = sanitizeText(read.text).slice(0, MAX_CAPTURE_CHARS);
  const title = contentType.toLowerCase().includes('text/html')
    ? sanitizeText(read.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 200)
    : undefined;
  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  const snapshot: ResearchSourceCaptureSnapshot = {
    schemaVersion: 'pyrfor.research_source_capture.v1',
    createdAt,
    runId,
    sourceMode: 'governed_source_capture',
    requestedUrl: normalized.publicUrl,
    requestedUrlHash: normalized.urlHash,
    requestedHost: normalized.host,
    requestedPathHash: normalized.pathHash,
    finalUrl: final.publicUrl,
    finalUrlHash: final.urlHash,
    finalHost: final.host,
    statusCode: response.status,
    contentType: contentType.split(';')[0]?.trim().toLowerCase() || 'text/plain',
    ...(title ? { title } : {}),
    contentHash: hashText(contentText),
    capturedBytes: read.bytes,
    truncated: read.truncated || contentText.length < sanitizeText(read.text).length,
    excerpt: contentText.slice(0, MAX_EXCERPT_CHARS),
    ...(normalized.note ? { note: normalized.note } : {}),
    effectsExecuted: [{
      kind: 'research_source_capture',
      approvalId,
      executedAt: createdAt,
      requestedUrlHash: normalized.urlHash,
      finalUrlHash: final.urlHash,
    }],
  };
  return {
    normalized,
    snapshot,
    artifactDocument: {
      snapshot,
      contentText,
    },
  };
}
