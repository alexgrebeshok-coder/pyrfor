/**
 * Unit tests for `lib/ai/multimodal/{stt,vision}.ts`.
 *
 * Covers:
 *   - OpenAI STT provider: availability + successful transcription + error.
 *   - STTRouter: cross-provider fallback when the first one throws.
 *   - OpenAI Vision provider: describe + verify JSON parsing.
 *   - VisionRouter: fallback behaviour mirrors STT.
 *
 * The global `fetch` is stubbed for each test — no network traffic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MockSTTProvider,
  OpenAISTTProvider,
  STTRouter,
  __resetSTTRouterForTests,
} from "@/lib/ai/multimodal/stt";
import {
  MockVisionProvider,
  OpenAIVisionProvider,
  VisionRouter,
  __resetVisionRouterForTests,
} from "@/lib/ai/multimodal/vision";

describe("multimodal STT", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch" as never);
    __resetSTTRouterForTests();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("OpenAISTTProvider.isAvailable reflects presence of the API key", () => {
    expect(new OpenAISTTProvider("").isAvailable()).toBe(false);
    expect(new OpenAISTTProvider("sk-test").isAvailable()).toBe(true);
  });

  it("OpenAISTTProvider parses a verbose_json Whisper response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ text: "Привет, мир", language: "ru", duration: 1.23 }),
        { status: 200, headers: { "content-type": "application/json" } }
      ) as never
    );

    const provider = new OpenAISTTProvider("sk-test");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

    const result = await provider.transcribe(blob, "clip.webm", { language: "ru" });

    expect(result.text).toBe("Привет, мир");
    expect(result.language).toBe("ru");
    expect(result.durationSeconds).toBe(1.23);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("whisper-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("OpenAISTTProvider surfaces API errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("upstream error", { status: 500 }) as never
    );

    const provider = new OpenAISTTProvider("sk-test");
    const blob = new Blob([new Uint8Array([1])], { type: "audio/webm" });

    await expect(provider.transcribe(blob, "clip.webm")).rejects.toThrow(
      /OpenAI STT API error: 500/
    );
  });

  it("STTRouter falls back to the next provider on failure", async () => {
    const failing: OpenAISTTProvider = Object.assign(new OpenAISTTProvider("sk"), {
      transcribe: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const succeeding = new MockSTTProvider();
    const router = new STTRouter([failing, succeeding]);

    const result = await router.transcribe(
      new Blob([new Uint8Array()]),
      "audio.webm"
    );
    expect(result.provider).toBe("mock");
    expect(failing.transcribe).toHaveBeenCalledTimes(1);
  });

  it("STTRouter throws when preferred provider is unavailable", async () => {
    const router = new STTRouter([new OpenAISTTProvider(""), new MockSTTProvider()]);
    await expect(
      router.transcribe(new Blob([new Uint8Array()]), "a.webm", { provider: "openai" })
    ).rejects.toThrow(/not available/);
  });
});

describe("multimodal Vision", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch" as never);
    __resetVisionRouterForTests();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("OpenAIVisionProvider.describe returns the textual description", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "A cat on a chair." } }],
        }),
        { status: 200 }
      ) as never
    );

    const provider = new OpenAIVisionProvider("sk-test");
    const result = await provider.describe({ kind: "url", url: "https://example.com/cat.jpg" });

    expect(result.description).toBe("A cat on a chair.");
    expect(result.provider).toBe("openai");
  });

  it("OpenAIVisionProvider.verify parses a JSON verdict", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"verdict":"confirmed","confidence":0.92,"reason":"Worker wearing hard hat is visible."}',
              },
            },
          ],
        }),
        { status: 200 }
      ) as never
    );

    const provider = new OpenAIVisionProvider("sk-test");
    const result = await provider.verify(
      { kind: "url", url: "https://example.com/site.jpg" },
      { claim: "Worker is wearing a hard hat" }
    );

    expect(result.verdict).toBe("confirmed");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reason).toMatch(/hard hat/i);
    expect(result.provider).toBe("openai");
  });

  it("OpenAIVisionProvider.verify normalises malformed verdicts to 'uncertain'", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "this is not JSON" } }],
        }),
        { status: 200 }
      ) as never
    );

    const provider = new OpenAIVisionProvider("sk-test");
    const result = await provider.verify(
      { kind: "url", url: "https://example.com/site.jpg" },
      { claim: "Some claim" }
    );

    expect(result.verdict).toBe("uncertain");
    expect(result.confidence).toBe(0);
  });

  it("OpenAIVisionProvider.verify clamps out-of-range confidence to [0,1]", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"verdict":"refuted","confidence":2.5,"reason":"n/a"}',
              },
            },
          ],
        }),
        { status: 200 }
      ) as never
    );

    const provider = new OpenAIVisionProvider("sk-test");
    const result = await provider.verify(
      { kind: "url", url: "https://example.com/x.jpg" },
      { claim: "Some claim" }
    );

    expect(result.verdict).toBe("refuted");
    expect(result.confidence).toBe(1);
  });

  it("VisionRouter falls back to the next provider on failure", async () => {
    const failing = new OpenAIVisionProvider("sk");
    failing.describe = vi.fn().mockRejectedValue(new Error("boom"));
    failing.verify = vi.fn().mockRejectedValue(new Error("boom"));

    const router = new VisionRouter([failing, new MockVisionProvider()]);

    const describeResult = await router.describe({
      kind: "url",
      url: "https://example.com/x.jpg",
    });
    expect(describeResult.provider).toBe("mock");

    const verifyResult = await router.verify(
      { kind: "url", url: "https://example.com/x.jpg" },
      { claim: "Some claim" }
    );
    expect(verifyResult.provider).toBe("mock");
  });
});
