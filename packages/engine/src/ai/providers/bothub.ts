import type { AIProvider, Message, ChatOptions } from "./base";

export class BothubProvider implements AIProvider {
  name = 'bothub';
  models = ['gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet', 'deepseek-r1', 'qwen-2.5-coder', 'yandexgpt'];

  private apiKey: string;
  private baseUrl = 'https://bothub.chat/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BOTHUB_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) throw new Error('BOTHUB_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bothub API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
