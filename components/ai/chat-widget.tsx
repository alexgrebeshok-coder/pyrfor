/**
 * AI Chat Widget - Embedded chat in Dashboard
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChatMessage } from './chat-message';
import { Loader2, Send, Bot, Settings } from 'lucide-react';
import Link from 'next/link';
import {
  normalizeChatConfidence,
  normalizeChatFacts,
  type AIChatResponsePayload,
} from '@/lib/ai/chat-response';
import type { AIConfidenceSummary, AIEvidenceFact } from '@/lib/ai/types';

// ============================================
// Types
// ============================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  facts?: AIEvidenceFact[];
  confidence?: AIConfidenceSummary;
}

interface ChatWidgetProps {
  projectId?: string;
  className?: string;
}

// ============================================
// Chat Widget
// ============================================

export function AIChatWidget({ projectId, className }: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<string>('openrouter');
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const providerLabels: Record<string, string> = {
    openrouter: 'OpenRouter',
    zai: 'ZAI',
    openai: 'OpenAI',
    gigachat: 'GigaChat',
    yandexgpt: 'YandexGPT',
  };
  const providerOptions = availableProviders.length > 0
    ? availableProviders
    : ['openrouter', 'zai', 'openai'];

  // Fetch available providers on mount
  useEffect(() => {
    fetch('/api/ai/chat')
      .then((res) => res.json())
      .then((data) => {
        setAvailableProviders(data.providers || []);
        if (data.default) setProvider(data.default);
      })
      .catch(console.error);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          projectId,
          provider,
        }),
      });

      const data = (await response.json()) as AIChatResponsePayload;

      if (data.success) {
        const assistantMessage: Message = {
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: data.response || '',
          timestamp: new Date().toISOString(),
          facts: normalizeChatFacts(data.facts),
          confidence: normalizeChatConfidence(data.confidence),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        // Error message
        const errorMessage: Message = {
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: `❌ Ошибка: ${data.error || 'Не удалось получить ответ'}`,
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `❌ Ошибка сети: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Handle Enter key
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Clear chat
  function clearChat() {
    setMessages([]);
  }

  return (
    <Card className={`flex flex-col h-[600px] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">CEOClaw AI</h2>
          <Badge variant="info" className="text-xs">
            {providerLabels[provider] || provider}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clearChat}>
            Очистить
          </Button>
          <Link href="/settings/ai">
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Привет! Я CEOClaw AI</p>
            <p className="text-sm mt-2">
              Ассистент для управления проектами.
              <br />
              Могу помочь с задачами, поиском информации, кодом.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} {...msg} />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Печатает...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Напишите сообщение..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span>
            Provider:{' '}
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="bg-transparent border-none cursor-pointer"
            >
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {providerLabels[p] || p}
                </option>
              ))}
            </select>
          </span>
          <span>Enter — отправить</span>
        </div>
      </div>
    </Card>
  );
}
