export type ConceptStatus =
  | 'queued'
  | 'planning'
  | 'researching'
  | 'executing'
  | 'critiquing'
  | 'postmortem'
  | 'persisting_memory'
  | 'done'
  | 'failed'
  | 'aborted';

export interface ArtifactRef {
  id: string;
  kind: string;
  sha256?: string;
  createdAt?: string;
}

export interface ConceptRecord {
  conceptId: string;
  goal: string;
  runId: string;
  status: ConceptStatus | string;
  phases: string[];
  currentPhase?: string;
  artifactRefs?: ArtifactRef[];
  planRef?: ArtifactRef;
  critiqueRef?: ArtifactRef;
  createdAt: string;
  completedAt?: string;
}

export interface PhaseSummary {
  phase: string;
  status: 'current' | 'completed' | string;
}

export interface StartConceptInput {
  goal: string;
  workspaceId?: string;
  conceptId?: string;
  runId?: string;
  dryRun?: boolean;
  strategies?: string[];
}

export interface StartConceptResponse {
  conceptId: string;
  runId: string;
  status: 'queued' | string;
}

export interface ConceptsResponse {
  concepts: ConceptRecord[];
}

export interface PhasesResponse {
  phases: PhaseSummary[];
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  run_id?: string;
  effect_id?: string;
  effect_kind?: string;
  policy_id?: string;
  reason?: string;
  approval_required?: boolean;
}

export interface SseMessage {
  event: string;
  data: string;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null;
}>;

export class UniversalApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as FetchLike,
  ) {}

  async listConcepts(): Promise<ConceptRecord[]> {
    const body = await this.requestJson('/api/concepts');
    if (!isConceptsResponse(body)) throw new Error('Invalid concepts response');
    return body.concepts;
  }

  async startConcept(input: StartConceptInput): Promise<StartConceptResponse> {
    const body = await this.requestJson('/api/concepts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!isStartConceptResponse(body)) throw new Error('Invalid start concept response');
    return body;
  }

  async getPhases(conceptId: string): Promise<PhaseSummary[]> {
    const body = await this.requestJson(`/api/concepts/${encodeURIComponent(conceptId)}/phases`);
    if (!isPhasesResponse(body)) throw new Error('Invalid concept phases response');
    return body.phases;
  }

  async listPendingApprovals(): Promise<ApprovalRequest[]> {
    const body = await this.requestJson('/api/approvals/pending');
    if (!isApprovalsResponse(body)) throw new Error('Invalid approvals response');
    return body.approvals;
  }

  async decideApproval(id: string, decision: 'approve' | 'deny'): Promise<void> {
    await this.requestJson(`/api/approvals/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  }

  async abortConcept(conceptId: string): Promise<void> {
    await this.requestJson(`/api/concepts/${encodeURIComponent(conceptId)}`, { method: 'DELETE' });
  }

  async streamConceptEvents(
    conceptId: string,
    handlers: {
      onSnapshot?: (snapshot: unknown) => void;
      onLedger?: (event: unknown) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<{ dispose(): void }> {
    const controller = new AbortController();
    void this.readSse(`/api/concepts/${encodeURIComponent(conceptId)}/events/stream`, controller, handlers);
    return { dispose: () => controller.abort() };
  }

  private async requestJson(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method: init.method ?? 'GET',
      headers: this.headers(init.body !== undefined),
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (!response.ok) {
      throw new Error(`Universal Engine request failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  private async readSse(
    path: string,
    controller: AbortController,
    handlers: {
      onSnapshot?: (snapshot: unknown) => void;
      onLedger?: (event: unknown) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<void> {
    try {
      const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        headers: this.headers(false),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Universal Engine stream failed with HTTP ${response.status}`);
      if (!response.body) throw new Error('Universal Engine stream response has no body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const message of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          this.dispatchSseMessage(message, handlers);
        }
      }
      for (const message of parser.flush()) this.dispatchSseMessage(message, handlers);
    } catch (error) {
      if (!controller.signal.aborted) handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private dispatchSseMessage(
    message: SseMessage,
    handlers: {
      onSnapshot?: (snapshot: unknown) => void;
      onLedger?: (event: unknown) => void;
      onError?: (error: Error) => void;
    },
  ): void {
    try {
      const parsed: unknown = JSON.parse(message.data);
      if (message.event === 'snapshot') handlers.onSnapshot?.(parsed);
      if (message.event === 'ledger') {
        const event = isPlainObject(parsed) && 'event' in parsed ? parsed.event : parsed;
        handlers.onLedger?.(event);
      }
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private headers(hasBody: boolean): Record<string, string> {
    return {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }
}

export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let boundary = findMessageBoundary(this.buffer);
    while (boundary !== -1) {
      const raw = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      const message = parseSseBlock(raw);
      if (message) messages.push(message);
      boundary = findMessageBoundary(this.buffer);
    }
    return messages;
  }

  flush(): SseMessage[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }
    const message = parseSseBlock(this.buffer);
    this.buffer = '';
    return message ? [message] : [];
  }
}

export function gatewayHttpBaseFromDaemonUrl(daemonUrl: string): string {
  let url: URL;
  try {
    url = new URL(daemonUrl);
  } catch {
    return 'http://127.0.0.1:18790';
  }
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'http://127.0.0.1:18790';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function findMessageBoundary(input: string): { index: number; length: number } | -1 {
  const lf = input.indexOf('\n\n');
  const crlf = input.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (lf === -1) return { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function parseSseBlock(raw: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

function isConceptsResponse(value: unknown): value is ConceptsResponse {
  return isPlainObject(value) && Array.isArray(value.concepts);
}

function isStartConceptResponse(value: unknown): value is StartConceptResponse {
  return (
    isPlainObject(value) &&
    typeof value.conceptId === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.status === 'string'
  );
}

function isPhasesResponse(value: unknown): value is PhasesResponse {
  return isPlainObject(value) && Array.isArray(value.phases);
}

function isApprovalsResponse(value: unknown): value is { approvals: ApprovalRequest[] } {
  return isPlainObject(value) && Array.isArray(value.approvals);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
