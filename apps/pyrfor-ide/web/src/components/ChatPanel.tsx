import React, { useState, useRef, useEffect, useCallback } from 'react';
import { chat, chatStream, chatStreamMultipart, fsRead, transcribeAudio, type OpenFile, type ChatAttachment } from '../lib/api';
import { parseSseFrames } from '../lib/sse-parser';
import { parseCodeBlocks, type CodeBlock } from '../lib/parse-code-blocks';
import { useDaemonHealth } from '../hooks/useDaemonHealth';
import * as offlineQueue from '../lib/offlineQueue';
import { setDrainHandler } from '../lib/queueDrainer';
import type { TabData } from '../App';

interface ChatPanelProps {
  cwd: string;
  workspace: string;
  tabs: TabData[];
  activeTab: string | null;
  onApplyToFile: (path: string, content: string) => void;
  onOpenOrFocusTab: (path: string, content: string, language: string) => void;
  onToast: (msg: string, type?: string, dur?: number) => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  rulesLoaded?: boolean;
}

interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  streaming?: boolean;
  tools?: ToolEvent[];
  error?: string;
  attachments?: Array<{ kind: 'audio' | 'image'; url: string; mime: string; size: number }>;
  /** True when the message was enqueued while offline and has not been sent yet. */
  queued?: boolean;
}

interface PendingDiff {
  filePath: string;
  currentContent: string;
  proposedContent: string;
}

const MAX_OPEN_FILES_BYTES = 64 * 1024;

export function buildOpenFiles(tabs: TabData[], activeTab: string | null): OpenFile[] {
  const ordered: TabData[] = [];
  const seen = new Set<string>();
  if (activeTab) {
    const a = tabs.find((t) => t.path === activeTab);
    if (a) {
      ordered.push(a);
      seen.add(a.path);
    }
  }
  for (const t of tabs) {
    if (!seen.has(t.path) && t.dirty) {
      ordered.push(t);
      seen.add(t.path);
    }
  }
  for (const t of tabs) {
    if (!seen.has(t.path)) {
      ordered.push(t);
      seen.add(t.path);
    }
  }
  const out: OpenFile[] = [];
  let total = 0;
  for (const t of ordered) {
    const size = t.content.length;
    if (total + size > MAX_OPEN_FILES_BYTES) break;
    total += size;
    out.push({ path: t.path, content: t.content, language: t.language });
  }
  return out;
}

type DiffKind = 'same' | 'add' | 'remove';
interface DiffLine {
  kind: DiffKind;
  line: string;
}

function computeLineDiff(original: string, proposed: string): DiffLine[] {
  const a = original.split('\n');
  const b = proposed.split('\n');
  const n = a.length,
    m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      result.push({ kind: 'same', line: a[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || (dp[i + 1] && dp[i + 1][j] <= dp[i][j + 1]))) {
      result.push({ kind: 'add', line: b[j] });
      j++;
    } else {
      result.push({ kind: 'remove', line: a[i] });
      i++;
    }
  }
  return result;
}

function truncateArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  } catch {
    return '…';
  }
}

function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
  };
  return map[ext] || 'plaintext';
}

interface AssistantSegment {
  type: 'text' | 'code';
  text?: string;
  block?: CodeBlock;
}

function segmentMessage(text: string): AssistantSegment[] {
  const blocks = parseCodeBlocks(text);
  if (blocks.length === 0) return [{ type: 'text', text }];
  const segs: AssistantSegment[] = [];
  let last = 0;
  // Need to recompute end indices via regex match
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let bi = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segs.push({ type: 'text', text: text.slice(last, m.index) });
    }
    segs.push({ type: 'code', block: blocks[bi++] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: 'text', text: text.slice(last) });
  return segs;
}

export default function ChatPanel({
  workspace,
  tabs,
  activeTab,
  onApplyToFile,
  onOpenOrFocusTab,
  onToast,
  inputRef,
  rulesLoaded,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<PendingDiff | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [queuedCount, setQueuedCount] = useState(() => offlineQueue.list().length);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { status: daemonStatus } = useDaemonHealth();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Keep queued count in sync across renders and tabs.
  useEffect(() => offlineQueue.onChange(() => setQueuedCount(offlineQueue.list().length)), []);

  const updateAssistant = useCallback(
    (id: string, fn: (m: ChatMessage) => ChatMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    },
    []
  );

  const runStream = useCallback(
    async (text: string, assistantId: string) => {
      const openFiles = buildOpenFiles(tabs, activeTab);
      const ac = new AbortController();
      abortRef.current = ac;
      let receivedAnyToken = false;
      try {
        const res = await chatStream({ text, openFiles, workspace, signal: ac.signal });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { frames, remainder } = parseSseFrames(buf);
          buf = remainder;
          for (const frame of frames) {
            if (frame.event === 'done') {
              return { ok: true, receivedAnyToken };
            }
            if (frame.event === 'error') {
              let msg = 'stream error';
              try {
                const parsed = JSON.parse(frame.data);
                msg = parsed.message || msg;
              } catch {
                /* ignore */
              }
              updateAssistant(assistantId, (m) => ({ ...m, error: msg, streaming: false }));
              return { ok: false, receivedAnyToken };
            }
            // data event
            try {
              const parsed = JSON.parse(frame.data);
              if (parsed.type === 'token' && typeof parsed.text === 'string') {
                receivedAnyToken = true;
                updateAssistant(assistantId, (m) => ({ ...m, text: m.text + parsed.text }));
              } else if (parsed.type === 'tool' && typeof parsed.name === 'string') {
                updateAssistant(assistantId, (m) => ({
                  ...m,
                  tools: [...(m.tools ?? []), { name: parsed.name, args: parsed.args ?? {} }],
                }));
              } else if (parsed.type === 'tool_result') {
                updateAssistant(assistantId, (m) => {
                  const tools = [...(m.tools ?? [])];
                  for (let i = tools.length - 1; i >= 0; i--) {
                    if (tools[i].name === parsed.name && tools[i].result === undefined) {
                      tools[i] = { ...tools[i], result: parsed.result };
                      break;
                    }
                  }
                  return { ...m, tools };
                });
              } else if (parsed.type === 'final' && typeof parsed.text === 'string') {
                receivedAnyToken = true;
                updateAssistant(assistantId, (m) => ({ ...m, text: parsed.text }));
              }
            } catch {
              /* skip malformed */
            }
          }
        }
        return { ok: true, receivedAnyToken };
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [tabs, activeTab, workspace, updateAssistant]
  );

  const runMultipartStream = useCallback(
    async (text: string, files: File[], assistantId: string) => {
      const openFiles = buildOpenFiles(tabs, activeTab);
      const ac = new AbortController();
      abortRef.current = ac;
      let receivedAnyToken = false;
      try {
        await chatStreamMultipart({
          text,
          attachments: files,
          openFiles,
          workspace,
          signal: ac.signal,
          onChunk: (t) => {
            receivedAnyToken = true;
            updateAssistant(assistantId, (m) => ({ ...m, text: m.text + t }));
          },
          onAttachments: (atts) => {
            // Attach to the user message so they render alongside it.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId.replace(/^a-/, 'u-')
                  ? { ...m, attachments: atts }
                  : m,
              ),
            );
          },
          onTool: (name, args) => {
            updateAssistant(assistantId, (m) => ({
              ...m,
              tools: [...(m.tools ?? []), { name, args }],
            }));
          },
          onToolResult: (name, result) => {
            updateAssistant(assistantId, (m) => {
              const tools = [...(m.tools ?? [])];
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === name && tools[i].result === undefined) {
                  tools[i] = { ...tools[i], result };
                  break;
                }
              }
              return { ...m, tools };
            });
          },
          onError: (msg) => {
            updateAssistant(assistantId, (m) => ({ ...m, error: msg, streaming: false }));
          },
        });
        return { ok: true, receivedAnyToken };
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [tabs, activeTab, workspace, updateAssistant],
  );

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if ((!text && pendingAttachments.length === 0) || streaming) return;
      if (overrideText === undefined) setInput('');
      const filesToSend = pendingAttachments;
      const now = Date.now();

      // ── Offline: enqueue immediately and show queued indicator ──────────────
      if (daemonStatus === 'offline') {
        const hadAttachments = filesToSend.length > 0;
        if (hadAttachments) {
          onToast(
            'Attachments cannot be queued offline — text will be queued without files.',
            'warning',
          );
        }
        if (filesToSend.length > 0) setPendingAttachments([]);
        offlineQueue.enqueue({
          kind: hadAttachments ? 'multipart' : 'text',
          payload: {
            text,
            openFiles: buildOpenFiles(tabs, activeTab),
            workspace,
            hadAttachments,
          },
        });
        setMessages((prev) => [
          ...prev,
          { id: `u-${now}`, role: 'user', text, ts: now, queued: true },
        ]);
        return;
      }
      // ────────────────────────────────────────────────────────────────────────

      const userMsg: ChatMessage = {
        id: `u-${now}`,
        role: 'user',
        text,
        ts: now,
      };
      const assistantId = `a-${now}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        ts: now,
        streaming: true,
        tools: [],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      if (filesToSend.length > 0) setPendingAttachments([]);
      setStreaming(true);
      try {
        if (filesToSend.length > 0) {
          await runMultipartStream(text, filesToSend, assistantId);
        } else {
          const result = await runStream(text, assistantId);
          if (!result.receivedAnyToken && !result.ok) {
            try {
              const data = await chat(text);
              updateAssistant(assistantId, (m) => ({
                ...m,
                text: data.reply || '(empty response)',
                error: undefined,
              }));
            } catch (err: any) {
              updateAssistant(assistantId, (m) => ({
                ...m,
                error: err?.message || 'fallback failed',
              }));
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          updateAssistant(assistantId, (m) => ({ ...m, error: 'cancelled' }));
        } else if (err instanceof TypeError) {
          // Network error — daemon unreachable; enqueue for retry on reconnect.
          const hadAttachments = filesToSend.length > 0;
          if (hadAttachments) {
            onToast(
              'Attachments cannot be queued offline — text will be queued without files.',
              'warning',
            );
          }
          offlineQueue.enqueue({
            kind: hadAttachments ? 'multipart' : 'text',
            payload: {
              text,
              openFiles: buildOpenFiles(tabs, activeTab),
              workspace,
              hadAttachments,
            },
          });
          // Replace the optimistic assistant bubble with a queued indicator.
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== assistantId)
              .map((m) => (m.id === `u-${now}` ? { ...m, queued: true } : m)),
          );
        } else if (filesToSend.length === 0) {
          // fallback to non-streaming chat on transport error
          try {
            const data = await chat(text);
            updateAssistant(assistantId, (m) => ({
              ...m,
              text: data.reply || '(empty response)',
            }));
          } catch (e: any) {
            const msg = e?.message || err?.message || 'unknown error';
            onToast(`Chat error: ${msg}`, 'error');
            updateAssistant(assistantId, (m) => ({ ...m, error: msg }));
          }
        } else {
          const msg = err?.message || 'unknown error';
          onToast(`Chat error: ${msg}`, 'error');
          updateAssistant(assistantId, (m) => ({ ...m, error: msg }));
        }
      } finally {
        updateAssistant(assistantId, (m) => ({ ...m, streaming: false }));
        setStreaming(false);
      }
    },
    [input, streaming, pendingAttachments, runStream, runMultipartStream, updateAssistant, onToast, daemonStatus, tabs, activeTab, workspace],
  );

  // Register the drain handler so queueDrainer can replay queued messages
  // through the same send path when the daemon recovers.
  useEffect(() => {
    setDrainHandler(async (item) => {
      await sendMessage(item.payload.text);
    });
    return () => setDrainHandler(null);
  }, [sendMessage]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blobType = mr.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        setTranscribing(true);
        try {
          const { text } = await transcribeAudio(blob);
          setInput((prev) => (prev ? prev + ' ' + text : text));
        } catch (err: any) {
          onToast(`Transcription failed: ${err?.message ?? 'unknown error'}`, 'error');
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (err: any) {
      onToast(`Microphone error: ${err?.message ?? 'permission denied'}`, 'error');
    }
  }, [onToast]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  const handleApplyClick = useCallback(
    async (path: string, proposed: string) => {
      const tab = tabs.find((t) => t.path === path);
      let current = '';
      if (tab) {
        current = tab.content;
      } else {
        try {
          const res = await fsRead(path);
          current = res.content;
        } catch {
          current = '';
        }
      }
      setPendingDiff({ filePath: path, currentContent: current, proposedContent: proposed });
    },
    [tabs]
  );

  const acceptDiff = useCallback(() => {
    if (!pendingDiff) return;
    const { filePath, proposedContent } = pendingDiff;
    const tab = tabs.find((t) => t.path === filePath);
    if (!tab) {
      onOpenOrFocusTab(filePath, proposedContent, langFromPath(filePath));
    }
    onApplyToFile(filePath, proposedContent);
    setPendingDiff(null);
  }, [pendingDiff, tabs, onApplyToFile, onOpenOrFocusTab]);

  const rejectDiff = useCallback(() => setPendingDiff(null), []);

  const retryLast = useCallback(() => {
    // find last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        sendMessage(messages[i].text);
        return;
      }
    }
  }, [messages, sendMessage]);

  return (
    <>
      <div className="panel-header">
        <span>Chat</span>
        {rulesLoaded && (
          <span className="rules-badge" title=".pyrforrules loaded" data-testid="rules-badge">
            rules ✓
          </span>
        )}
        {queuedCount > 0 && (
          <span className="queued-badge" title="Messages queued while offline" data-testid="queued-badge">
            📬 {queuedCount} queued
            <button
              className="queued-badge-discard"
              title="Discard all queued messages"
              onClick={() => {
                offlineQueue.clear();
                setMessages((prev) => prev.map((m) => m.queued ? { ...m, queued: false, error: 'discarded' } : m));
              }}
            >
              Discard
            </button>
          </span>
        )}
        <button className="icon-btn" title="Clear chat" onClick={() => setMessages([])}>
          ✕
        </button>
      </div>
      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((msg) => {
          const time = new Date(msg.ts).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="chat-msg user">
                <div className="chat-bubble" style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                </div>
                {msg.queued && (
                  <div className="queued-chip" data-testid="queued-chip">
                    📬 queued — will send when online
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="chat-attachments" data-testid="chat-attachments">
                    {msg.attachments.map((a, i) =>
                      a.kind === 'image' ? (
                        <img
                          key={i}
                          src={a.url}
                          alt="attachment"
                          style={{ maxWidth: '300px', display: 'block', marginTop: '4px' }}
                        />
                      ) : (
                        <audio key={i} controls src={a.url} style={{ display: 'block', marginTop: '4px' }} />
                      ),
                    )}
                  </div>
                )}
                <div className="chat-msg-time">{time}</div>
              </div>
            );
          }
          const segments = segmentMessage(msg.text);
          return (
            <div key={msg.id} className="chat-msg assistant">
              {(msg.tools ?? []).map((t, i) => (
                <span key={i} className="tool-pill" data-testid="tool-pill">
                  🔧 ran <code>{t.name}</code>: {truncateArgs(t.args)}
                  {t.result !== undefined ? <span> → {truncateArgs(t.result)}</span> : null}
                </span>
              ))}
              <div className="chat-bubble">
                {segments.map((seg, i) => {
                  if (seg.type === 'text') {
                    return (
                      <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
                        {seg.text}
                      </span>
                    );
                  }
                  const block = seg.block!;
                  return (
                    <div key={i} className="code-block-wrap">
                      <button
                        className="code-block-copy-btn"
                        onClick={() => {
                          const key = `${msg.id}-${i}`;
                          navigator.clipboard.writeText(block.content).then(() => {
                            setCopiedKey(key);
                            setTimeout(() => setCopiedKey(k => k === key ? null : k), 1500);
                          });
                        }}
                      >
                        {copiedKey === `${msg.id}-${i}` ? 'Copied!' : 'Copy'}
                      </button>
                      <pre>
                        <code className={`lang-${block.lang}`}>{block.content}</code>
                      </pre>
                      {block.path && (
                        <button
                          className="btn btn-secondary btn-sm chat-apply-btn"
                          onClick={() => handleApplyClick(block.path!, block.content)}
                        >
                          Apply to {block.path}
                        </button>
                      )}
                    </div>
                  );
                })}
                {msg.streaming && <span className="cursor">▌</span>}
              </div>
              {msg.error && (
                <div className="chat-error" role="alert">
                  Error: {msg.error}{' '}
                  <button className="btn btn-sm" onClick={retryLast}>
                    Retry
                  </button>
                </div>
              )}
              <div className="chat-msg-time">{time}</div>
            </div>
          );
        })}
        {streaming && (
          <div id="typing-indicator">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        {pendingAttachments.length > 0 && (
          <div className="chat-pending-attachments" data-testid="pending-attachments">
            {pendingAttachments.map((f, i) => (
              <span key={i} className="attachment-chip">
                {f.name}
                <button
                  type="button"
                  className="attachment-chip-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          multiple
          style={{ display: 'none' }}
          data-testid="attach-input"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            if (files.length > 0) {
              setPendingAttachments((prev) => [...prev, ...files]);
            }
            // Reset so selecting the same file twice still triggers onChange
            if (e.target) e.target.value = '';
          }}
        />
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
          rows={3}
          autoComplete="off"
          spellCheck={true}
          value={input}
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="chat-actions">
          {transcribing && (
            <span className="transcribing-indicator" aria-live="polite">
              transcribing…
            </span>
          )}
          <button
            className="icon-btn attach-btn"
            title="Attach files (image or audio)"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            data-testid="attach-btn"
          >
            📎
          </button>
          <button
            className={`icon-btn mic-btn${recording ? ' mic-btn--recording' : ''}`}
            title={recording ? 'Stop recording' : 'Record voice message'}
            aria-label={recording ? 'Stop recording' : 'Record voice message'}
            onClick={toggleRecording}
            disabled={streaming || transcribing}
            data-testid="mic-btn"
          >
            {recording ? '⏹' : '🎤'}
          </button>
          {streaming ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={cancelStream}
              data-testid="chat-cancel"
            >
              Cancel
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => sendMessage()}
              disabled={streaming}
            >
              Send
            </button>
          )}
        </div>
      </div>
      {pendingDiff && (
        <div className="diff-overlay" role="dialog">
          <div className="diff-modal">
            <div className="diff-modal-header">
              Apply changes to <code>{pendingDiff.filePath}</code>
            </div>
            <pre className="diff-content">
              {computeLineDiff(pendingDiff.currentContent, pendingDiff.proposedContent).map(
                (d, i) => (
                  <div
                    key={i}
                    style={{
                      color:
                        d.kind === 'add' ? '#4ade80' : d.kind === 'remove' ? '#f87171' : '#fff',
                      whiteSpace: 'pre',
                    }}
                  >
                    {d.kind === 'add' ? '+ ' : d.kind === 'remove' ? '- ' : '  '}
                    {d.line}
                  </div>
                )
              )}
            </pre>
            <div className="diff-modal-actions">
              <button className="btn btn-primary btn-sm" onClick={acceptDiff}>
                Accept
              </button>
              <button className="btn btn-secondary btn-sm" onClick={rejectDiff}>
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
