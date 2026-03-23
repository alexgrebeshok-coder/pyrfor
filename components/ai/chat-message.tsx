/**
 * Chat Message - Single message component
 */

'use client';

import { cn } from '@/lib/utils';
import { User, Bot } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { AIConfidenceSummary, AIEvidenceFact } from '@/lib/ai/types';
import { EvidenceSummaryBlock } from '@/components/ai/evidence-summary-block';
import { useLocale } from '@/contexts/locale-context';

// ============================================
// Types
// ============================================

interface ChatMessageProps {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  facts?: AIEvidenceFact[];
  confidence?: AIConfidenceSummary;
}

// ============================================
// Chat Message
// ============================================

export function ChatMessage({ role, content, timestamp, facts, confidence }: ChatMessageProps) {
  const isUser = role === 'user';
  const { locale } = useLocale();
  const factsTitle = locale === "en" ? "Facts" : locale === "zh" ? "事实" : "Факты";

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Message */}
      <div
        className={cn(
          'flex-1 max-w-[80%] rounded-lg p-3',
          isUser
            ? 'bg-primary text-primary-foreground ml-auto'
            : 'bg-muted'
        )}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {formatMessage(content)}
        </div>
        {!isUser ? (
          <EvidenceSummaryBlock facts={facts} confidence={confidence} title={factsTitle} />
        ) : null}
        <div
          className={cn(
            'text-xs mt-1 opacity-70',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {formatTime(timestamp)}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Helpers
// ============================================

/**
 * Format message content (markdown-like)
 */
function formatMessage(content: string): React.ReactNode {
  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    // Code block
    if (part.startsWith('```') && part.endsWith('```')) {
      const code = part.slice(3, -3);
      const [lang, ...lines] = code.split('\n');
      const codeContent = lines.join('\n');

      return (
        <pre key={i} className="bg-black/10 rounded p-2 overflow-x-auto text-xs my-2">
          <code>{codeContent}</code>
        </pre>
      );
    }

    // Inline code
    const withInlineCode = part.replace(
      /`([^`]+)`/g,
      '<code class="bg-black/10 px-1 rounded">$1</code>'
    );

    // Bold
    const withBold = withInlineCode.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong>$1</strong>'
    );

    // Italic
    const withItalic = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    const withBreaks = withItalic.replace(/\n/g, '<br/>');

    // Sanitize HTML to prevent XSS
    const sanitized = DOMPurify.sanitize(withBreaks);

    return (
      <span
        key={i}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  });
}

/**
 * Format timestamp
 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
