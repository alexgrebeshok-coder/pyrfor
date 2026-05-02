import { getSecretValue, setSecretValue, deleteSecretValue } from './authStorage';

export interface CloudFallbackConfig {
  enabled: boolean;
  provider: 'openrouter';
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

const STORAGE_KEY = 'pyrfor.cloudFallback.v1';
const OPENROUTER_SECRET_KEY = 'provider:openrouter';

const DEFAULTS: CloudFallbackConfig = {
  enabled: false,
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: null,
  model: 'openrouter/auto',
};

export function getCloudFallbackConfig(): CloudFallbackConfig {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<CloudFallbackConfig>;
    return { ...DEFAULTS, ...parsed, apiKey: null };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setCloudFallbackConfig(cfg: Partial<CloudFallbackConfig>): void {
  const current = getCloudFallbackConfig();
  const { apiKey: _apiKey, ...safeCfg } = cfg;
  const next: CloudFallbackConfig = { ...current, ...safeCfg, apiKey: null };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}

export async function getCloudFallbackApiKey(): Promise<string> {
  return getSecretValue(OPENROUTER_SECRET_KEY);
}

export async function setCloudFallbackApiKey(apiKey: string): Promise<void> {
  await setSecretValue(OPENROUTER_SECRET_KEY, apiKey);
}

export async function deleteCloudFallbackApiKey(): Promise<void> {
  await deleteSecretValue(OPENROUTER_SECRET_KEY);
}

export class CloudFallbackUnavailableError extends Error {
  constructor(reason: string) {
    super(`Cloud fallback unavailable: ${reason}`);
    this.name = 'CloudFallbackUnavailableError';
  }
}

export interface ChatStreamCloudParams {
  text: string;
  sessionId?: string;
  openFiles?: Array<{ path: string; content: string; language?: string }>;
  workspace?: string;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream a chat completion directly from the configured cloud provider
 * (OpenRouter by default) without going through the local daemon.
 */
export async function chatStreamCloud(params: ChatStreamCloudParams): Promise<void> {
  const cfg = getCloudFallbackConfig();

  if (!cfg.enabled) {
    throw new CloudFallbackUnavailableError('cloud fallback is disabled');
  }
  const apiKey = await getCloudFallbackApiKey();
  if (!apiKey) {
    throw new CloudFallbackUnavailableError('no API key configured');
  }

  const systemParts: string[] = ['You are a helpful coding assistant.'];
  if (params.workspace) {
    systemParts.push(`Workspace: ${params.workspace}`);
  }
  if (params.openFiles && params.openFiles.length > 0) {
    const fileSummary = params.openFiles
      .map((f) => `File: ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``)
      .join('\n\n');
    systemParts.push(`Open files:\n${fileSummary}`);
  }

  const messages = [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: params.text },
  ];

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Cloud provider HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);

      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content.length > 0) {
          params.onChunk(content);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
}
