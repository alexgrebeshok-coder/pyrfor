/**
 * session-summarizer.ts — Pyrfor runtime: SessionSummarizer.
 *
 * Compresses long chat sessions while preserving key facts.
 * Keeps system messages + last N messages within token budget,
 * summarises the rest via an injected LLM factory.
 */

// ── Local types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  tokens?: number;
}

export interface SummarizeResult {
  summary: string;
  preserved: ChatMessage[];
  droppedCount: number;
}

export interface SessionSummarizerOptions {
  llm: (prompt: string) => Promise<string>;
  maxTokens?: number;
  reservedTokens?: number;
  estimateTokens?: (s: string) => number;
}

export interface SessionSummarizer {
  summarize(messages: ChatMessage[]): Promise<SummarizeResult>;
  compress(messages: ChatMessage[]): Promise<ChatMessage[]>;
  estimate(messages: ChatMessage[]): number;
  shouldCompress(messages: ChatMessage[]): boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultEstimate = (s: string): number => Math.ceil(s.length / 4);

function formatTranscript(messages: ChatMessage[]): string {
  return messages.map((m) => `\n[${m.role}] ${m.content}\n`).join('');
}

function buildPrompt(formatted: string): string {
  return (
    'Summarize the following conversation transcript concisely, preserving: ' +
    'user goals, decisions made, errors encountered, key facts, and any unresolved tasks. ' +
    'Output a 200-400 word summary in plain text.\n\n' +
    `TRANSCRIPT:\n${formatted}\n\nSUMMARY:`
  );
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSessionSummarizer(opts: SessionSummarizerOptions): SessionSummarizer {
  const {
    llm,
    maxTokens = 8000,
    reservedTokens = 2000,
    estimateTokens = defaultEstimate,
  } = opts;

  const budget = maxTokens - reservedTokens;

  function estimate(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  function shouldCompress(messages: ChatMessage[]): boolean {
    return estimate(messages) > budget;
  }

  async function summarize(messages: ChatMessage[]): Promise<SummarizeResult> {
    if (messages.length === 0) {
      return { summary: '', preserved: [], droppedCount: 0 };
    }

    // Separate leading system messages
    let sysEnd = 0;
    while (sysEnd < messages.length && messages[sysEnd].role === 'system') {
      sysEnd++;
    }
    const systemMsgs = messages.slice(0, sysEnd);
    const nonSystemMsgs = messages.slice(sysEnd);

    // Walk backwards, keeping messages within budget
    const systemTokens = systemMsgs.reduce((s, m) => s + estimateTokens(m.content), 0);
    let remaining = budget - systemTokens;
    const tailIndices: number[] = [];

    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
      const t = estimateTokens(nonSystemMsgs[i].content);
      if (remaining - t >= 0) {
        remaining -= t;
        tailIndices.unshift(i);
      } else {
        break;
      }
    }

    const tailMsgs = tailIndices.map((i) => nonSystemMsgs[i]);
    const droppedMsgs = nonSystemMsgs.filter((_, i) => !tailIndices.includes(i));
    const droppedCount = droppedMsgs.length;

    if (droppedCount === 0) {
      return { summary: '', preserved: [...systemMsgs, ...tailMsgs], droppedCount: 0 };
    }

    const formatted = formatTranscript(droppedMsgs);
    const prompt = buildPrompt(formatted);
    const result = await llm(prompt);
    const summary = '[Conversation summary]\n' + result;

    return {
      summary,
      preserved: [...systemMsgs, ...tailMsgs],
      droppedCount,
    };
  }

  async function compress(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const { summary, preserved, droppedCount } = await summarize(messages);

    if (droppedCount === 0) {
      return messages.slice();
    }

    // Split preserved into leading system messages and the rest
    let sysEnd = 0;
    while (sysEnd < preserved.length && preserved[sysEnd].role === 'system') {
      sysEnd++;
    }
    const preservedSystem = preserved.slice(0, sysEnd);
    const preservedRest = preserved.slice(sysEnd);

    const summaryMsg: ChatMessage = { role: 'system', content: summary };

    return [...preservedSystem, summaryMsg, ...preservedRest];
  }

  return { summarize, compress, estimate, shouldCompress };
}
