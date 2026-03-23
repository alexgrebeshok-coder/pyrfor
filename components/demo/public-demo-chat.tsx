"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Bot, Loader2, Send, Sparkles, Trash2 } from "lucide-react";

import { ChatMessage } from "@/components/ai/chat-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface DemoMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface UsageState {
  count: number;
  resetAt: number;
}

interface PublicDemoChatProps {
  projectId?: string | null;
  className?: string;
}

const STORAGE_KEY = "ceoclaw-demo-chat-usage-v1";
const MAX_REQUESTS = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const PROMPTS = [
  "Покажи главный риск",
  "Что с бюджетом?",
  "Что я должен сделать на этой неделе?",
];

const initialMessage = createMessage(
  "assistant",
  "Это публичное демо. Я отвечаю по seed-данным CEOClaw и учитываю только факты из контекста. У вас 5 запросов на этот браузер."
);

export function PublicDemoChat({ projectId, className }: PublicDemoChatProps) {
  const [messages, setMessages] = useState<DemoMessage[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<UsageState>(() => ({
    count: 0,
    resetAt: Date.now() + WINDOW_MS,
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as UsageState;
      if (
        typeof parsed.count !== "number" ||
        typeof parsed.resetAt !== "number" ||
        parsed.resetAt <= Date.now()
      ) {
        setUsage({
          count: 0,
          resetAt: Date.now() + WINDOW_MS,
        });
      } else {
        setUsage(parsed);
      }
    } catch {
      setUsage({
        count: 0,
        resetAt: Date.now() + WINDOW_MS,
      });
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
    } catch {
      // Ignore storage errors in browsers that block persistence.
    }
  }, [hydrated, usage]);

  const remaining = useMemo(() => Math.max(MAX_REQUESTS - usage.count, 0), [usage.count]);
  const isLocked = remaining === 0;

  async function sendMessage(value: string) {
    if (!value.trim() || isLoading || isLocked) {
      return;
    }

    const userMessage = createMessage("user", value);
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/demo/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: conversation.map(({ role, content }) => ({ role, content })),
          projectId,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        success?: boolean;
        response?: string;
        error?: string;
      };

      if (!payload.success) {
        throw new Error(payload.error || "Demo response failed");
      }

      setMessages((current) => [
        ...current,
        createMessage("assistant", payload.response || "Ответ недоступен."),
      ]);
      setUsage((current) => ({
        ...current,
        count: current.count + 1,
      }));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unknown error";
      setError(message);
      setMessages((current) => [
        ...current,
        createMessage("assistant", `Не удалось получить демо-ответ: ${message}`),
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handlePromptClick(prompt: string) {
    void sendMessage(prompt);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  function resetConversation() {
    setMessages([initialMessage]);
    setInput("");
    setError(null);
  }

  return (
    <Card className={`flex h-full flex-col overflow-hidden border-[color:var(--line)] bg-[color:var(--surface-panel)]/96 ${className ?? ""}`}>
      <CardHeader className="space-y-3 border-b border-[color:var(--line)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--brand)] text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg tracking-[-0.04em]">Public demo chat</CardTitle>
              <p className="text-sm text-[var(--ink-soft)]">
                5 запросов на браузер · факты из seed-данных
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={isLocked ? "warning" : "info"}>
              {isLocked ? "Лимит достигнут" : `${remaining} / ${MAX_REQUESTS}`}
            </Badge>
            <Button onClick={resetConversation} size="sm" variant="ghost">
              <Trash2 className="h-4 w-4" />
              Сбросить
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              disabled={isLoading || isLocked}
              onClick={() => handlePromptClick(prompt)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Sparkles className="h-4 w-4" />
              {prompt}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((message) => (
            <ChatMessage key={message.id} {...message} />
          ))}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Думаю на основе фактов и seed-данных...
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-[color:var(--line)] pt-4">
          {error ? <p className="text-sm text-rose-500">{error}</p> : null}

          {isLocked ? (
            <div className="rounded-2xl border border-[color:var(--line)] bg-[var(--panel-soft)] p-3 text-sm text-[var(--ink-soft)]">
              Лимит демо-запросов исчерпан. Чтобы продолжить, откройте
              <a className="ml-1 font-medium text-[var(--brand)]" href="/signup">
                доступ к продукту
              </a>
              .
            </div>
          ) : null}

          <div className="flex gap-2">
            <Input
              disabled={isLoading || isLocked}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Спросите о бюджете, рисках или следующем шаге..."
              value={input}
            />
            <Button
              disabled={isLoading || isLocked || input.trim().length === 0}
              onClick={() => void sendMessage(input)}
              size="icon"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>

          <p className="text-xs text-[var(--ink-soft)]">
            Демо не требует регистрации, но сообщения ограничены пятью запросами на браузер.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function createMessage(role: DemoMessage["role"], content: string): DemoMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}
