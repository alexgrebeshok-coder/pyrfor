import type { AIProvider, Message, ChatOptions } from "./base";

export class ZAIProvider implements AIProvider {
  name = 'zai';
  models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];

  private apiKey: string;
  private baseUrl = 'https://api.zukijourney.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ZAI_API_KEY || '';
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    if (!this.apiKey) throw new Error('ZAI_API_KEY not set');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || 'glm-5',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZAI API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
