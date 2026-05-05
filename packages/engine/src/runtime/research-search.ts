import type { ResearchEvidenceSourceInput, ResearchSearchProvider } from './research-evidence';

const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 5;
const QUERY_MAX_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface GovernedResearchSearchInput {
  query: string;
  maxResults?: number;
  provider?: ResearchSearchProvider;
}

export interface GovernedResearchSearchResult {
  provider: ResearchSearchProvider;
  executedAt: string;
  maxResults: number;
  results: ResearchEvidenceSourceInput[];
}

export interface GovernedResearchSearchReadinessProvider {
  provider: ResearchSearchProvider;
  configured: boolean;
  missingEnv: string[];
  readiness: {
    state: 'configured' | 'pending';
    reasons: string[];
    nextStep: string;
  };
}

export interface GovernedResearchSearchReadiness {
  checkedAt: string;
  statusSource: 'local-config';
  liveProbeSkipped: true;
  approvalRequired: true;
  status: 'ready' | 'unavailable';
  defaultProvider: ResearchSearchProvider | null;
  configuredProvider: ResearchSearchProvider | null;
  allowedProviders: ResearchSearchProvider[];
  reasons: string[];
  nextStep: string;
  providers: GovernedResearchSearchReadinessProvider[];
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeResearchSearchInput(input: GovernedResearchSearchInput): { query: string; maxResults: number } {
  const query = cleanText(input.query);
  if (!query) throw new Error('ResearchSearch: query is required');
  if (query.length > QUERY_MAX_LENGTH) throw new Error(`ResearchSearch: query is limited to ${QUERY_MAX_LENGTH} characters`);
  const requested = input.maxResults ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(requested) || requested <= 0) throw new Error('ResearchSearch: maxResults must be a positive integer');
  return {
    query,
    maxResults: Math.min(requested, HARD_MAX_RESULTS),
  };
}

export function resolveGovernedResearchSearchProvider(env: NodeJS.ProcessEnv = process.env): ResearchSearchProvider {
  const configured = cleanText(env['PYRFOR_RESEARCH_SEARCH_PROVIDER'])?.toLowerCase();
  if (configured && configured !== 'brave' && configured !== 'duckduckgo') {
    throw new Error('ResearchSearch: unsupported provider; expected brave or duckduckgo');
  }
  if (configured === 'duckduckgo') return 'duckduckgo';
  if (configured === 'brave' || cleanText(env['BRAVE_API_KEY'])) return 'brave';
  throw new Error('ResearchSearch: BRAVE_API_KEY is required for governed search, or set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo');
}

export function getGovernedResearchSearchReadiness(
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): GovernedResearchSearchReadiness {
  const configuredRaw = cleanText(env['PYRFOR_RESEARCH_SEARCH_PROVIDER'])?.toLowerCase();
  const configuredProvider = configuredRaw === 'brave' || configuredRaw === 'duckduckgo'
    ? configuredRaw
    : null;
  const braveConfigured = Boolean(cleanText(env['BRAVE_API_KEY']));
  const providers: GovernedResearchSearchReadinessProvider[] = [
    {
      provider: 'brave',
      configured: braveConfigured,
      missingEnv: braveConfigured ? [] : ['BRAVE_API_KEY'],
      readiness: {
        state: braveConfigured ? 'configured' : 'pending',
        reasons: braveConfigured
          ? ['BRAVE_API_KEY env name is present in local configuration.']
          : ['Missing required env: BRAVE_API_KEY'],
        nextStep: braveConfigured
          ? 'Request governed search approval to capture Brave evidence.'
          : 'Set BRAVE_API_KEY or choose DuckDuckGo as the governed search provider.',
      },
    },
    {
      provider: 'duckduckgo',
      configured: true,
      missingEnv: [],
      readiness: {
        state: 'configured',
        reasons: ['DuckDuckGo governed search requires no local credential env vars.'],
        nextStep: 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo or select DuckDuckGo for an individual search.',
      },
    },
  ];
  let defaultProvider: ResearchSearchProvider | null = null;
  let status: GovernedResearchSearchReadiness['status'] = 'ready';
  let reasons: string[] = [];
  let nextStep = 'Request governed search approval from a run to capture evidence.';
  try {
    defaultProvider = resolveGovernedResearchSearchProvider(env);
    if (defaultProvider === 'brave' && !braveConfigured) {
      status = 'unavailable';
      reasons = ['ResearchSearch: BRAVE_API_KEY is required for Brave search'];
      nextStep = 'Set BRAVE_API_KEY or switch PYRFOR_RESEARCH_SEARCH_PROVIDER to duckduckgo.';
    } else {
      reasons = [`Default governed search provider is ${defaultProvider}.`];
    }
  } catch (err) {
    status = 'unavailable';
    reasons = [err instanceof Error ? err.message : 'ResearchSearch: provider unavailable'];
    nextStep = configuredRaw && configuredProvider === null
      ? 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER to brave or duckduckgo.'
      : 'Set BRAVE_API_KEY or PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo before requesting governed search.';
  }
  return {
    checkedAt: now().toISOString(),
    statusSource: 'local-config',
    liveProbeSkipped: true,
    approvalRequired: true,
    status,
    defaultProvider,
    configuredProvider,
    allowedProviders: ['brave', 'duckduckgo'],
    reasons,
    nextStep,
    providers,
  };
}

function validHttpUrl(value: unknown): string | undefined {
  const url = cleanText(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function abortSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

async function runBraveSearch(
  query: string,
  maxResults: number,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ResearchEvidenceSourceInput[]> {
  const apiKey = cleanText(env['BRAVE_API_KEY']);
  if (!apiKey) throw new Error('ResearchSearch: BRAVE_API_KEY is required for Brave search');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: abortSignal(timeoutMs),
    });
  } catch {
    throw new Error('ResearchSearch: brave request failed');
  }
  if (!response.ok) throw new Error(`ResearchSearch: brave HTTP ${response.status}`);
  const data = await response.json().catch(() => {
    throw new Error('ResearchSearch: brave returned invalid JSON');
  }) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? [])
    .flatMap((item): ResearchEvidenceSourceInput[] => {
      const url = validHttpUrl(item.url);
      if (!url) return [];
      return [{
        url,
        ...(cleanText(item.title) ? { title: cleanText(item.title) } : {}),
        ...(cleanText(item.description) ? { snippet: cleanText(item.description) } : {}),
        observedAt: new Date().toISOString(),
      }];
    })
    .slice(0, maxResults);
}

async function runDuckDuckGoSearch(
  query: string,
  maxResults: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ResearchEvidenceSourceInput[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: abortSignal(timeoutMs),
    });
  } catch {
    throw new Error('ResearchSearch: duckduckgo request failed');
  }
  if (!response.ok) throw new Error(`ResearchSearch: duckduckgo HTTP ${response.status}`);
  const data = await response.json().catch(() => {
    throw new Error('ResearchSearch: duckduckgo returned invalid JSON');
  }) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
  };
  const results: ResearchEvidenceSourceInput[] = [];
  const abstractUrl = validHttpUrl(data.AbstractURL);
  if (abstractUrl && cleanText(data.AbstractText)) {
    results.push({
      url: abstractUrl,
      title: cleanText(data.Heading) ?? query,
      snippet: cleanText(data.AbstractText),
      observedAt: new Date().toISOString(),
    });
  }
  for (const topic of data.RelatedTopics ?? []) {
    const topicUrl = validHttpUrl(topic.FirstURL);
    const topicText = cleanText(topic.Text);
    if (topicUrl && topicText) {
      results.push({
        url: topicUrl,
        title: topicText.split(' - ')[0] || 'Related',
        snippet: topicText,
        observedAt: new Date().toISOString(),
      });
    }
    if (results.length >= maxResults) break;
  }
  return results.slice(0, maxResults);
}

export async function runGovernedResearchSearch(
  input: GovernedResearchSearchInput,
  opts: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
  } = {},
): Promise<GovernedResearchSearchResult> {
  const normalized = normalizeResearchSearchInput(input);
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const provider = input.provider ?? resolveGovernedResearchSearchProvider(env);
  const results = provider === 'brave'
    ? await runBraveSearch(normalized.query, normalized.maxResults, fetchImpl, env, timeoutMs)
    : await runDuckDuckGoSearch(normalized.query, normalized.maxResults, fetchImpl, timeoutMs);
  if (results.length === 0) throw new Error(`ResearchSearch: ${provider} returned no usable results`);
  return {
    provider,
    executedAt: (opts.now ?? (() => new Date()))().toISOString(),
    maxResults: normalized.maxResults,
    results,
  };
}
