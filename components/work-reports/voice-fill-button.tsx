"use client";

/**
 * Voice-to-textarea button.
 *
 * Wraps the existing useVoiceTranscription hook (Wave H) so any form
 * can drop a small mic button next to a textarea. Clicking it records
 * audio in the browser, posts to /api/ai/transcribe, and appends the
 * resulting transcript into the target textarea (by `name` lookup
 * within the closest <form>).
 *
 * Used by Wave I to add voice intake to the work-report builder
 * without disrupting the existing keyboard-first flow.
 */
import { useCallback, useId } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVoiceTranscription } from "@/lib/hooks/use-voice-transcription";

export interface VoiceFillButtonProps {
  /** name attribute of the target textarea/input within the same <form>. */
  targetName: string;
  /** BCP-47 language hint forwarded to STT. Default "ru-RU". */
  language?: string;
  /** Optional biasing prompt forwarded to STT (e.g. domain glossary). */
  prompt?: string;
  /** Optional className for the wrapper. */
  className?: string;
  /** Render the label next to the icon. Default true. */
  showLabel?: boolean;
}

function appendToTarget(buttonId: string, targetName: string, text: string) {
  if (typeof document === "undefined" || !text) return;
  const button = document.getElementById(buttonId);
  const form = button?.closest("form");
  if (!form) return;
  const target = form.elements.namedItem(targetName) as
    | HTMLTextAreaElement
    | HTMLInputElement
    | null;
  if (!target) return;
  const sep = target.value && !target.value.endsWith(" ") ? " " : "";
  target.value = `${target.value}${sep}${text}`;
  // Notify React-controlled inputs.
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export function VoiceFillButton({
  targetName,
  language = "ru-RU",
  prompt,
  className,
  showLabel = true,
}: VoiceFillButtonProps) {
  const buttonId = useId();
  const voice = useVoiceTranscription({
    language,
    prompt,
    onTranscript: (text) => appendToTarget(buttonId, targetName, text),
  });

  const handleClick = useCallback(() => {
    if (voice.isRecording) {
      void voice.stop();
    } else if (!voice.isTranscribing) {
      void voice.start();
    }
  }, [voice]);

  if (!voice.isSupported) return null;

  const label = voice.isRecording
    ? "Остановить запись"
    : voice.isTranscribing
      ? "Распознаю..."
      : "Надиктовать";

  return (
    <Button
      id={buttonId}
      type="button"
      variant={voice.isRecording ? "default" : "secondary"}
      size="sm"
      disabled={voice.isTranscribing}
      onClick={handleClick}
      className={className}
      aria-label={label}
      title={voice.error ?? label}
    >
      {voice.isTranscribing ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : voice.isRecording ? (
        <Square className="w-3.5 h-3.5 fill-current" />
      ) : (
        <Mic className="w-3.5 h-3.5" />
      )}
      {showLabel ? <span className="ml-1.5">{label}</span> : null}
    </Button>
  );
}
