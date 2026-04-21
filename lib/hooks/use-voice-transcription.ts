"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side voice capture that posts the recorded audio to
 * `/api/ai/transcribe` (Whisper / provider-routed STT).
 *
 * Why this hook exists:
 *   The existing chat composer used `window.SpeechRecognition`, which
 *   is Chromium-only and sends audio to Google. Wave H wires in the
 *   server route so Firefox / Safari users (and any deployment that
 *   wants to stay on its own STT provider) get the same experience.
 *
 * Design notes:
 *   • Uses `MediaRecorder` — supported in every evergreen browser,
 *     including iOS Safari 14.5+ and Firefox.
 *   • Picks the first MIME the browser supports from a prioritised
 *     list so we always ship a format Whisper / GigaChat STT can
 *     digest (webm/opus, mp4/aac, ogg/opus).
 *   • Errors and permission denials surface through the `error`
 *     state; the hook never throws into a click handler.
 *   • The hook cleans its `MediaStream` tracks on unmount so a
 *     hot-reloaded component doesn't leave the browser mic indicator
 *     lit.
 */

type VoiceStatus = "idle" | "recording" | "transcribing" | "error";

export interface VoiceTranscriptionOptions {
  /** Target endpoint; defaults to the route shipped in this repo. */
  endpoint?: string;
  /** BCP-47 language hint forwarded to the STT provider. */
  language?: string;
  /** Optional biasing prompt (e.g. domain glossary). */
  prompt?: string;
  /** Force a provider by id ("openai", "gigachat", ...). */
  provider?: string;
  /** Override the server model hint. */
  model?: string;
  /** Called when the server returns a transcript. */
  onTranscript?: (text: string) => void;
  /** Called when recording stops, before upload. */
  onRecordingComplete?: (blob: Blob) => void;
  /** Upper bound on recording length (ms). Default: 60_000. */
  maxDurationMs?: number;
}

export interface VoiceTranscriptionState {
  status: VoiceStatus;
  transcript: string;
  error: string | null;
  durationMs: number;
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
];

function pickSupportedMime(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // Some browsers (older Safari) throw on unknown types; keep looping.
    }
  }
  return undefined;
}

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}

export function useVoiceTranscription(
  options: VoiceTranscriptionOptions = {}
): VoiceTranscriptionState {
  const {
    endpoint = "/api/ai/transcribe",
    language,
    prompt,
    provider,
    model,
    onTranscript,
    onRecordingComplete,
    maxDurationMs = 60_000,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("audio/webm");
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A flip-switch we use to let `stop()` wait for the recorder's `stop`
  // event; we can't rely on the recorder being synchronous.
  const stopResolverRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef<boolean>(false);

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator?.mediaDevices?.getUserMedia);

  const cleanupStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore — best effort
        }
      });
    }
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanupStream();
    setStatus("idle");
    setTranscript("");
    setError(null);
    setDurationMs(0);
  }, [cleanupStream]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    cleanupStream();
    setStatus("idle");
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("MediaRecorder is not supported in this browser");
      setStatus("error");
      return;
    }
    if (status === "recording" || status === "transcribing") return;

    setError(null);
    setTranscript("");
    setDurationMs(0);
    cancelledRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickSupportedMime();
      mimeRef.current = mime ?? "audio/webm";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;
        if (resolver) resolver();
      });

      recorder.addEventListener("error", (event) => {
        const detail = (event as { error?: unknown }).error;
        const message = detail instanceof Error ? detail.message : "recorder error";
        setError(message);
        setStatus("error");
      });

      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");

      // Hard ceiling on recording length so a forgotten mic doesn't
      // accumulate multi-minute audio and blow the 25 MB server cap.
      timerRef.current = setTimeout(() => {
        void stopInternal();
      }, maxDurationMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes("denied") || message.includes("NotAllowed")
          ? "Microphone permission denied"
          : message
      );
      setStatus("error");
      cleanupStream();
    }
    // `stopInternal` is declared below and stable via ref; safe to ignore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported, maxDurationMs, status, cleanupStream]);

  const stopInternal = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupStream();
      return;
    }

    setStatus("transcribing");
    setDurationMs(Math.max(0, Date.now() - startedAtRef.current));

    await new Promise<void>((resolve) => {
      stopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

    // Free the mic right away so the browser indicator vanishes.
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
    }
    streamRef.current = null;
    recorderRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (cancelledRef.current) {
      setStatus("idle");
      chunksRef.current = [];
      return;
    }

    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (chunks.length === 0) {
      setStatus("idle");
      return;
    }

    const blob = new Blob(chunks, { type: mimeRef.current });
    if (onRecordingComplete) {
      try {
        onRecordingComplete(blob);
      } catch {
        // ignore — callback errors should not abort transcription
      }
    }

    try {
      const form = new FormData();
      const filename = `voice-${Date.now()}.${extensionForMime(mimeRef.current)}`;
      form.append("file", blob, filename);
      if (language) form.append("language", language);
      if (prompt) form.append("prompt", prompt);
      if (provider) form.append("provider", provider);
      if (model) form.append("model", model);

      const response = await fetch(endpoint, {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? `HTTP ${response.status}`);
      }

      const text = typeof data.text === "string" ? data.text : "";
      setTranscript(text);
      setStatus("idle");
      if (text && onTranscript) onTranscript(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
    }
  }, [cleanupStream, endpoint, language, model, onRecordingComplete, onTranscript, prompt, provider]);

  const stop = useCallback(async () => {
    await stopInternal();
  }, [stopInternal]);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    status,
    transcript,
    error,
    durationMs,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing",
    isSupported,
    start,
    stop,
    cancel,
    reset,
  };
}
