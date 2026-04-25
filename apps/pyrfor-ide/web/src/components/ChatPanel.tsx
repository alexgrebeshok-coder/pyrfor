import React, { useState, useRef, useEffect, useCallback } from 'react';
import { chat } from '../lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

interface ChatPanelProps {
  cwd: string;
  getActiveContent: () => string | null;
  activeFilePath: string | null;
  onApplyToFile: (code: string) => void;
  onToast: (msg: string, type?: string, dur?: number) => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMessage(text: string): { html: string; codeBlocks: number; lastCode: string | null } {
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let html = '';
  let last = 0;
  let codeBlocks = 0;
  let lastCode: string | null = null;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > last) {
      html += `<span style="white-space:pre-wrap">${escapeHtml(text.slice(last, match.index))}</span>`;
    }
    html += `<pre><code class="lang-${escapeHtml(match[1] || '')}">${escapeHtml(match[2])}</code></pre>`;
    codeBlocks++;
    lastCode = match[2];
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    html += `<span style="white-space:pre-wrap">${escapeHtml(text.slice(last))}</span>`;
  }
  return { html, codeBlocks, lastCode };
}

export default function ChatPanel({
  cwd,
  getActiveContent,
  activeFilePath,
  onApplyToFile,
  onToast,
  inputRef,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, busy]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput('');
    const userMsg: ChatMessage = { role: 'user', text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    try {
      const data = await chat(text);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: data.reply || '(empty response)', ts: Date.now() },
      ]);
    } catch (err: any) {
      onToast(`Chat error: ${err.message}`, 'error');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${err.message}`, ts: Date.now() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, onToast]);

  return (
    <>
      <div className="panel-header">
        <span>Chat</span>
        <button className="icon-btn" title="Clear chat" onClick={() => setMessages([])}>
          ✕
        </button>
      </div>
      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => {
          const { html, codeBlocks, lastCode } = parseMessage(msg.text);
          const time = new Date(msg.ts).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          return (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className="chat-bubble" dangerouslySetInnerHTML={{ __html: html }} />
              <div className="chat-msg-time">{time}</div>
              {msg.role === 'assistant' && codeBlocks === 1 && lastCode !== null && (
                <button
                  className="btn btn-secondary btn-sm chat-apply-btn"
                  onClick={() => {
                    if (!activeFilePath) {
                      onToast('No active file open', 'error');
                      return;
                    }
                    onApplyToFile(lastCode!);
                  }}
                >
                  Apply to active file
                </button>
              )}
            </div>
          );
        })}
        {busy && (
          <div id="typing-indicator">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
          rows={3}
          autoComplete="off"
          spellCheck={true}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="chat-actions">
          <button className="btn btn-primary btn-sm" onClick={sendMessage} disabled={busy}>
            Send
          </button>
        </div>
      </div>
    </>
  );
}
