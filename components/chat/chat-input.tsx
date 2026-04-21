"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Mic, Paperclip, SendHorizonal, Square, X, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import { useVoiceTranscription } from "@/lib/hooks/use-voice-transcription";

interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // base64
}

const modeLabelKey = {
  auto: "ai.mode.auto",
  mock: "ai.mode.mock",
  local: "ai.mode.local",
  gateway: "ai.mode.gateway",
  provider: "ai.mode.provider",
} as const;

export function ChatInput() {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const composerHelpId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { activeContext, agents, isSubmitting, preferredMode, selectedAgentId, submitPrompt, stopGeneration } = useAIWorkspace();
  const { t } = useLocale();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [message]);

  // Prefer the browser's native SpeechRecognition when available
  // (Chromium + Safari iOS 14.5+): zero round-trips, partial results.
  // Fall back to server-side MediaRecorder → /api/ai/transcribe so
  // Firefox users (and deployments that want to stay on their own
  // STT provider) still get voice input.
  const serverVoice = useVoiceTranscription({
    language: "ru-RU",
    onTranscript: (text) => {
      if (text) setMessage((prev) => (prev ? `${prev} ${text}` : text));
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "ru-RU";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setMessage(transcript);
    };

    recognition.onerror = (event) => {
      console.error("[Voice] Error:", event.error);
      setIsRecording(false);
      toast.error("Ошибка распознавания", {
        description: event.error === "not-allowed"
          ? "Дайте разрешение на микрофон в настройках браузера"
          : `Ошибка: ${event.error}`,
      });
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  // Surface server-path errors as a toast so the UX matches the
  // browser SpeechRecognition path above.
  useEffect(() => {
    if (serverVoice.status === "error" && serverVoice.error) {
      toast.error("Ошибка распознавания", {
        description: serverVoice.error,
      });
    }
  }, [serverVoice.status, serverVoice.error]);

  const toggleRecording = useCallback(() => {
    const recognition = recognitionRef.current;

    if (recognition) {
      if (isRecording) {
        recognition.stop();
        setIsRecording(false);
      } else {
        recognition.start();
        setIsRecording(true);
        toast.success("Запись начата", {
          description: "Говорите...",
          duration: 2000,
        });
      }
      return;
    }

    // Fallback path — server-side transcription via MediaRecorder.
    if (!serverVoice.isSupported) {
      toast.error("Голосовой ввод не поддерживается", {
        description: "Используйте Chrome, Safari или Edge",
      });
      return;
    }

    if (serverVoice.isRecording) {
      void serverVoice.stop();
    } else if (serverVoice.isTranscribing) {
      // already in flight — ignore
    } else {
      void serverVoice.start();
      toast.success("Запись начата", {
        description: "Говорите... по завершении нажмите снова",
        duration: 2000,
      });
    }
  }, [isRecording, serverVoice]);

  const serverRecordingActive = serverVoice.isRecording || serverVoice.isTranscribing;
  const voiceActive = isRecording || serverRecordingActive;
  const voiceBusy = serverVoice.isTranscribing;

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "text/plain", "text/csv",
      "application/json",
      "text/markdown",
    ];

    const newAttachments: Attachment[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > maxFileSize) {
        toast.error(`Файл слишком большой: ${file.name}`, {
          description: "Максимум 10MB",
        });
        return;
      }

      if (!allowedTypes.includes(file.type) && !file.name.endsWith(".md")) {
        toast.error(`Неподдерживаемый формат: ${file.name}`, {
          description: "Поддерживаются: изображения, PDF, TXT, CSV, JSON, MD",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        newAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          content,
        });

        if (newAttachments.length === files.length) {
          setAttachments((prev) => [...prev, ...newAttachments]);
          toast.success(`Добавлено ${newAttachments.length} файл(ов)`);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSubmit = async () => {
    if (!message.trim() && attachments.length === 0) return;

    const nextMessage = message;
    const nextAttachments = attachments;

    setMessage("");
    setAttachments([]);

    // Build prompt with attachments context
    let prompt = nextMessage;
    if (nextAttachments.length > 0) {
      const attachmentInfo = nextAttachments.map((a) => {
        if (a.type.startsWith("image/")) {
          return `[Изображение: ${a.name}]`;
        }
        return `[Файл: ${a.name}]`;
      }).join("\n");
      prompt = `${nextMessage}\n\nВложения:\n${attachmentInfo}`;
    }

    await submitPrompt(prompt);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="border-t border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] px-4 py-4 sm:px-6">
      <div className="mx-auto mb-3 flex max-w-5xl flex-wrap items-center gap-2">
        <Badge variant="neutral">
          {selectedAgent ? t(selectedAgent.nameKey) : t("agent.autoRouting")}
        </Badge>
        <Badge variant="info">{t(modeLabelKey[preferredMode])}</Badge>
        <span className="rounded-full bg-[var(--panel-soft)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          ⌘/ · {t("chat.sidebar.toggle")}
        </span>
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="mx-auto mb-3 flex max-w-5xl flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-panel-strong)] px-3 py-2"
            >
              {attachment.type.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4 text-blue-500" />
              ) : (
                <FileText className="h-4 w-4 text-gray-500" />
              )}
              <span className="max-w-[150px] truncate text-sm">{attachment.name}</span>
              <span className="text-xs text-[var(--ink-muted)]">{formatFileSize(attachment.size)}</span>
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="ml-1 rounded-full p-1 hover:bg-[var(--panel-soft)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto flex min-w-0 w-full max-w-5xl items-end gap-3">
        {/* File upload button */}
        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.csv,.json,.md"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            aria-label={t("chat.input.attach")}
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            type="button"
            variant="secondary"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          {attachments.length > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-[8px] font-bold text-white">
              {attachments.length}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 rounded-[20px] border border-[var(--line-strong)] bg-[color:var(--surface-panel-strong)] px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.1)]">
          <Textarea
            aria-describedby={composerHelpId}
            aria-label={t("chat.input.send")}
            className="min-h-[44px] max-h-[220px] resize-none border-none bg-transparent px-2 py-1 shadow-none focus:border-none focus:ring-0"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMessage("");
                return;
              }

              if (
                (event.metaKey || event.ctrlKey) &&
                (event.key === "Enter" || event.code === "Enter")
              ) {
                event.preventDefault();
                void handleSubmit();
                return;
              }

              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={t("chat.input.placeholder", { context: activeContext.title })}
            ref={textareaRef}
            rows={1}
            value={message}
          />
          <p className="px-2 pt-2 text-[11px] text-[var(--ink-muted)]" id={composerHelpId}>
            {t("chat.input.shortcuts")}
          </p>
        </div>

        {/* Voice input button */}
        <div className="relative">
          <Button
            aria-label={t("chat.input.voice")}
            onClick={toggleRecording}
            size="icon"
            type="button"
            variant={voiceActive ? "default" : "secondary"}
            className={voiceActive ? "animate-pulse bg-red-500 hover:bg-red-600" : ""}
          >
            {voiceActive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
          {voiceActive && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-bold text-white">
              {voiceBusy ? "…" : "●"}
            </span>
          )}
        </div>

        <Button
          aria-label={isSubmitting ? "Стоп" : t("chat.input.send")}
          disabled={!isSubmitting && (!message.trim() && attachments.length === 0)}
          onClick={isSubmitting ? stopGeneration : () => void handleSubmit()}
          size="icon"
          className={isSubmitting ? "bg-red-500 hover:bg-red-600" : "shadow-[0_10px_20px_rgba(37,99,235,0.18)]"}
        >
          {isSubmitting ? (
            <Square className="h-4 w-4" />
          ) : (
            <SendHorizonal className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
