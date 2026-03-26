import type { AIProvider, Message, ChatOptions } from "./base";

export class AIJoraProvider implements AIProvider {
  name = 'aijora';
  models = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'claude-3-5-sonnet', 'claude-3-haiku'];

  private apiKey: string;
  private baseUrl = 'https://api.aijora.com/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.AIJORA_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) throw new Error('AIJORA_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AIJora API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
