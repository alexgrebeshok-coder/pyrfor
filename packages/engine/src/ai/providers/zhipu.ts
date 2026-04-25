/**
 * Zhipu AI (api.z.ai) — Chinese AI provider.
 * Direct API access, separate from ZukiJourney proxy.
 */

import type { AIProvider, Message, ChatOptions } from './base';

export class ZhipuProvider implements AIProvider {
  name = 'zhipu';
  models = ['glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4'];

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ZHIPU_API_KEY || '';
    // Zhipu AI has multiple endpoints
    this.baseUrl = process.env.ZHIPU_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) throw new Error('ZHIPU_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'glm-5-turbo',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zhipu API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('ZHIPU_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'glm-5-turbo',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 4096,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zhipu API error: ${response.status} - ${error}`);
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
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as {
            choices: Array<{ delta?: { content?: string } }>;
          };
          if (parsed.choices?.[0]?.delta?.content) {
            yield parsed.choices[0].delta.content;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}
