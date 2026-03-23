'use client';

/**
 * AI Chat Panel - Floating draggable chat interface
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAIChat } from '@/hooks/use-ai-chat';
import { EvidenceSummaryBlock } from '@/components/ai/evidence-summary-block';
import { useLocale } from '@/contexts/locale-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  MessageSquare, 
  X, 
  Send, 
  Loader2, 
  Trash2,
  Bot,
  User,
  GripVertical
} from 'lucide-react';
import { isPublicAppPath } from "@/lib/public-paths";

interface Position {
  x: number;
  y: number;
}

interface AIChatPanelProps {
  projectId?: string;
  className?: string;
}

function formatToolResultData(data: unknown): string | null {
  if (data === undefined || data === null) {
    return null;
  }

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

const STORAGE_KEY = 'ceoclaw-chat-position';
const BUTTON_SIZE = 56; // h-14 w-14 = 56px
const DEFAULT_POSITION: Position = { x: 24, y: 24 }; // bottom-6 right-6 = 24px

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

/**
 * Inner chat panel component (always rendered if parent allows)
 */
function AIChatPanelInner({ projectId, className }: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { locale } = useLocale();
  const factsTitle = locale === "en" ? "Facts" : locale === "zh" ? "事实" : "Факты";

  const { messages, isLoading, error, sendMessage, clearMessages } = useAIChat({
    projectId,
  });

  // Load position from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPosition(parsed);
      }
    } catch (e) {
      // Ignore errors
    }
  }, []);

  // Save position to localStorage
  const savePosition = useCallback((pos: Position) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch (e) {
      // Ignore errors
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!buttonRef.current) return;
    
    e.preventDefault();
    const rect = buttonRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const newX = window.innerWidth - e.clientX + dragOffset.x - BUTTON_SIZE;
    const newY = window.innerHeight - e.clientY + dragOffset.y - BUTTON_SIZE;
    
    // Clamp to screen bounds
    const clampedX = Math.max(0, Math.min(newX, window.innerWidth - BUTTON_SIZE));
    const clampedY = Math.max(0, Math.min(newY, window.innerHeight - BUTTON_SIZE));
    
    setPosition({ x: clampedX, y: clampedY });
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      savePosition(position);
    }
  }, [isDragging, position, savePosition]);

  // Global mouse events
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleButtonClick = () => {
    if (!isDragging) {
      setIsOpen(true);
    }
  };

  if (!isOpen) {
    return (
      <Button
        ref={buttonRef}
        onMouseDown={handleMouseDown}
        onClick={handleButtonClick}
        className={`fixed h-14 w-14 rounded-full shadow-lg ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${className}`}
        style={{
          right: `${position.x}px`,
          bottom: `${position.y}px`,
        }}
        size="icon"
      >
        <MessageSquare className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <Card className={`fixed w-96 h-[500px] flex flex-col shadow-xl z-50 ${className}`}
      style={{
        right: `${position.x}px`,
        bottom: `${position.y}px`,
      }}
    >
      {/* Header */}
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b cursor-move"
        onMouseDown={(e) => {
          e.preventDefault();
          const card = e.currentTarget.closest('.fixed') as HTMLElement;
          if (!card) return;
          const rect = card.getBoundingClientRect();
          setDragOffset({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          setIsDragging(true);
        }}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">AI Ассистент</CardTitle>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clearMessages}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Привет! Чем могу помочь?</p>
          </div>
        )}
        
        {messages.map((msg) => {
          const resultData = msg.toolCall?.result
            ? formatToolResultData(msg.toolCall.result.data)
            : null;

          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-3 w-3" />
                </div>
              )}
              <div className="flex max-w-[80%] flex-col gap-1">
                <div
                  className={`rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <div className="space-y-3">
                    <div>{msg.content}</div>
                    {msg.role === 'assistant' ? (
                      <EvidenceSummaryBlock facts={msg.facts} confidence={msg.confidence} title={factsTitle} />
                    ) : null}
                  </div>
                </div>
                {msg.toolCall && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-tight text-muted-foreground">
                    <p className="font-semibold text-primary-foreground">
                      Вызов инструмента: {msg.toolCall.name}
                    </p>
                    <p className="text-[10px] font-medium text-muted-foreground mt-1">Параметры:</p>
                    <pre className="whitespace-pre-wrap font-mono text-[10px]">
                      {JSON.stringify(msg.toolCall.params, null, 2)}
                    </pre>
                    {msg.toolCall.result && (
                      <div className="mt-1">
                        <p
                          className={`text-[10px] font-medium ${
                            msg.toolCall.result.success ? 'text-success-foreground' : 'text-destructive'
                          }`}
                        >
                          {msg.toolCall.result.success ? 'Результат' : 'Ошибка инструмента'}
                          {msg.toolCall.result.error ? `: ${msg.toolCall.result.error}` : ''}
                        </p>
                        {msg.toolCall.result.success && resultData !== null && (
                          <pre className="whitespace-pre-wrap font-mono text-[10px]">
                            {resultData}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {msg.meta && (
                  <p className="text-[10px] text-muted-foreground">
                    {msg.meta.success ? 'Запрос прошёл успешно' : 'Отклик с ошибкой'} ·{' '}
                    {msg.meta.status ? `Статус: ${msg.meta.status} · ` : ''}
                    {msg.meta.runId ? `Run: ${msg.meta.runId.slice(0, 8)} · ` : ''}
                    {msg.meta.provider ?? 'Провайдер: —'} ·{' '}
                    {typeof msg.meta.duration === 'number'
                      ? `${msg.meta.duration} мс`
                      : '—'}
                  </p>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <User className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
            </div>
          );
        })}
        
        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-3 w-3" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </CardContent>

      {/* Input */}
      <div className="p-3 border-t">
        {error && (
          <p className="text-xs text-destructive mb-2">{error}</p>
        )}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Напишите сообщение..."
            className="flex-1"
            disabled={isLoading}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * AI Chat Panel - Wrapper that hides on public pages
 */
export function AIChatPanel(props: AIChatPanelProps) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  
  // Hide on public pages and small screens to keep the mobile shell clean.
  if (!isDesktop || isPublicAppPath(pathname)) {
    return null;
  }
  
  return <AIChatPanelInner {...props} />;
}
