/**
 * useAIChat - Hook for AI chat functionality
 */

import { useState, useCallback } from 'react';

import {
  normalizeChatConfidence,
  normalizeChatFacts,
  type AIChatResponsePayload,
} from '@/lib/ai/chat-response';
import type { AIConfidenceSummary, AIEvidenceFact } from '@/lib/ai/types';

interface ToolCallResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

interface ToolCall {
  name: string;
  params: Record<string, unknown>;
  result?: ToolCallResult;
}

interface MessageMeta {
  success: boolean;
  duration?: number;
  provider?: string;
  model?: string;
  status?: string;
  runId?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  meta?: MessageMeta;
  toolCall?: ToolCall;
  agent?: { id: string; name: string };
  facts?: AIEvidenceFact[];
  confidence?: AIConfidenceSummary;
}

interface UseAIChatOptions {
  provider?: string;
  model?: string;
  projectId?: string;
}

interface UseAIChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useAIChat(options: UseAIChatOptions = {}): UseAIChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMessageId = `user-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;

    // Add user message and placeholder
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user' as const, content, timestamp: new Date().toISOString() },
      { id: assistantId, role: 'assistant' as const, content: '', timestamp: new Date().toISOString() },
    ]);
    
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content }], // Only send current message
          stream: false,
          provider: options.provider,
          model: options.model,
          projectId: options.projectId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const data = (await response.json()) as AIChatResponsePayload;
      
      console.log('[useAIChat] Response:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Unknown error');
      }

      // Update assistant message with response
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: data.response || '',
                facts: normalizeChatFacts(data.facts),
                confidence: normalizeChatConfidence(data.confidence),
                meta: {
                  success: true,
                  provider: data.provider,
                  model: data.model,
                  runId: data.runId,
                  status: data.status,
                },
              }
            : message
        )
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('[useAIChat] Error:', errorMessage);
      // Remove empty placeholder on error
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && m.content === '')));
    } finally {
      setIsLoading(false);
    }
  }, [options.provider, options.model, options.projectId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
}
