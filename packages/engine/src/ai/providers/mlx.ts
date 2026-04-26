/**
 * MLX Provider — Local LLM inference via mlx-lm
 *
 * Connects to mlx_lm.server running on localhost:8080.
 * OpenAI-compatible /v1/chat/completions API. No API key required.
 */

import type { AIProvider, Message, ChatOptions } from './base';

export class MlxProvider implements AIProvider {
  name = 'mlx';
  models: string[] = [];

  private baseUrl: string;

  constructor({ baseUrl }: { baseUrl?: string } = {}) {
    this.baseUrl = baseUrl || process.env.PYRFOR_MLX_BASE_URL || 'http://localhost:8080';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return false;
      const data = await response.json();
      return Array.isArray(data?.data) && data.data.length >= 1;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data?.data || []).map((m: { id: string }) => m.id);
    } catch {
      return [];
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'default',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: false,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MLX error: ${response.status} - ${body}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'default',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MLX error: ${response.status} - ${body}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  }
}
