import type { AIProvider, Message, ChatOptions } from "./base";

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  models = ['gpt-5.2', 'gpt-5.1', 'gpt-4o'];

  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'gpt-5.2',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
