export type ExecutionMode = 'pyrfor' | 'freeclaude';

export interface ExecutionModeResponse {
  executionMode: ExecutionMode;
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function executionModeEndpointFromDaemonUrl(daemonUrl: string): string {
  const url = new URL(daemonUrl);
  if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported Pyrfor daemon URL protocol: ${url.protocol}`);
  }
  url.pathname = '/api/settings/execution-mode';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function fetchExecutionMode(
  daemonUrl: string,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
): Promise<ExecutionMode> {
  if (!fetchImpl) {
    throw new Error('fetch is not available in this VSCode runtime');
  }
  const endpoint = executionModeEndpointFromDaemonUrl(daemonUrl);
  const response = await fetchImpl(endpoint, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Execution mode request failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (isExecutionModeResponse(body)) {
    return body.executionMode;
  }
  throw new Error('Invalid execution mode response');
}

function isExecutionModeResponse(value: unknown): value is ExecutionModeResponse {
  if (!value || typeof value !== 'object') return false;
  const mode = (value as { executionMode?: unknown }).executionMode;
  return mode === 'pyrfor' || mode === 'freeclaude';
}
