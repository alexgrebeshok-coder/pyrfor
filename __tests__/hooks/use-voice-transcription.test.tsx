import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoiceTranscription } from "@/lib/hooks/use-voice-transcription";

/**
 * Minimal MediaRecorder stub. jsdom doesn't ship one, so we implement
 * the surface the hook touches: `start`, `stop`, `state`, event
 * listeners, and a static `isTypeSupported`.
 */
class FakeMediaRecorder {
  static lastInstance: FakeMediaRecorder | null = null;
  static supported = new Set<string>(["audio/webm;codecs=opus"]);
  static isTypeSupported(mime: string): boolean {
    return FakeMediaRecorder.supported.has(mime);
  }

  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeMediaRecorder.lastInstance = this;
  }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(cb);
  }

  emit(type: string, event: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    // Simulate a final dataavailable + stop event.
    this.emit("dataavailable", { data: new Blob(["audio-bytes"]) });
    this.emit("stop", {});
  }
}

function installMediaStack() {
  vi.stubGlobal(
    "MediaRecorder",
    FakeMediaRecorder as unknown as typeof MediaRecorder
  );
  const stream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    },
  } as unknown as Navigator);
}

describe("useVoiceTranscription", () => {
  beforeEach(() => {
    FakeMediaRecorder.lastInstance = null;
    FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus"]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports isSupported=false when MediaRecorder is missing", () => {
    // @ts-expect-error — intentional removal
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: vi.fn(),
      },
    } as unknown as Navigator);

    const { result } = renderHook(() => useVoiceTranscription());
    expect(result.current.isSupported).toBe(false);
  });

  it("records, uploads, and surfaces the server transcript", async () => {
    installMediaStack();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "привет мир" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useVoiceTranscription({ onTranscript, language: "ru-RU" })
    );

    expect(result.current.isSupported).toBe(true);

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.isRecording).toBe(true);
    expect(FakeMediaRecorder.lastInstance).toBeTruthy();

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(result.current.transcript).toBe("привет мир");
    });
    expect(onTranscript).toHaveBeenCalledWith("привет мир");
    expect(result.current.status).toBe("idle");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/transcribe");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("language")).toBe("ru-RU");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("reports an error when the server returns non-2xx", async () => {
    installMediaStack();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Transcription failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useVoiceTranscription());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("Transcription failed");
  });

  it("surfaces permission denials as an error without throwing", async () => {
    vi.stubGlobal(
      "MediaRecorder",
      FakeMediaRecorder as unknown as typeof MediaRecorder
    );
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new Error("NotAllowedError: denied")),
      },
    } as unknown as Navigator);

    const { result } = renderHook(() => useVoiceTranscription());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/permission|denied/i);
  });

  it("cancel() stops recording without uploading", async () => {
    installMediaStack();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useVoiceTranscription());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.cancel();
    });

    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
