// @vitest-environment node
/**
 * multimodal-router.test.ts — tests for createMultimodalRouter, detectKindFromMime,
 * and defaultVoiceSentiment.
 *
 * Design notes asserted here:
 *   - Voice mirroring wins over long-text document fallback.  When inbound.kind
 *     is 'voice' and voiceReplyOnVoice is true (default), decideReply always
 *     returns 'voice' regardless of reply length.
 *   - 'document' preference only applies when input was non-voice and
 *     replyText.length exceeds defaultLongTextChars.
 */

import { describe, it, expect } from 'vitest';

import {
  createMultimodalRouter,
  detectKindFromMime,
  defaultVoiceSentiment,
  type InboundMessage,
  type VoiceSentiment,
} from './multimodal-router.js';

// ── detectKindFromMime ────────────────────────────────────────────────────────

describe('detectKindFromMime', () => {
  it('image/png → photo', () => {
    expect(detectKindFromMime('image/png')).toBe('photo');
  });

  it('image/jpeg → photo', () => {
    expect(detectKindFromMime('image/jpeg')).toBe('photo');
  });

  it('audio/ogg → voice', () => {
    expect(detectKindFromMime('audio/ogg')).toBe('voice');
  });

  it('audio/mpeg → voice', () => {
    expect(detectKindFromMime('audio/mpeg')).toBe('voice');
  });

  it('video/mp4 → video', () => {
    expect(detectKindFromMime('video/mp4')).toBe('video');
  });

  it('application/pdf → document', () => {
    expect(detectKindFromMime('application/pdf')).toBe('document');
  });

  it('application/zip → document', () => {
    expect(detectKindFromMime('application/zip')).toBe('document');
  });

  it('undefined → unknown', () => {
    expect(detectKindFromMime(undefined)).toBe('unknown');
  });

  it('text/plain → unknown', () => {
    expect(detectKindFromMime('text/plain')).toBe('unknown');
  });
});

// ── defaultVoiceSentiment ─────────────────────────────────────────────────────

describe('defaultVoiceSentiment', () => {
  it('fast wpm from transcript → neg with high arousal (long message)', () => {
    // 50 words in 3.5 s → ~857 wpm — very fast, long duration
    const words = 'word '.repeat(50).trim();
    const result = defaultVoiceSentiment({ durationMs: 3_500, transcript: words });
    expect(result.label).toBe('neg');
    expect(result.arousal).toBeGreaterThan(0.65);
    expect(result.rateWpm).toBeGreaterThan(170);
  });

  it('fast wpm short burst → pos', () => {
    // 30 words in 2 s → 900 wpm, but short duration ≤ 3 000 ms
    const words = 'word '.repeat(30).trim();
    const result = defaultVoiceSentiment({ durationMs: 2_000, transcript: words });
    expect(result.label).toBe('pos');
    expect(result.arousal).toBeGreaterThan(0.65);
  });

  it('slow wpm → neu with low arousal', () => {
    // 2 words in 10 s → 12 wpm → arousal ≈ 0 → neu
    const result = defaultVoiceSentiment({
      durationMs: 10_000,
      transcript: 'hello world',
    });
    expect(result.label).toBe('neu');
    expect(result.arousal).toBeLessThan(0.3);
  });

  it('moderate wpm → pos', () => {
    // 20 words in 8 s → 150 wpm → arousal ≈ 0.75... wait: (150-90)/80=0.75 which is > 0.65
    // let's use 16 words in 8 s → 120 wpm → arousal = (120-90)/80 = 0.375 → pos
    const words = 'word '.repeat(16).trim();
    const result = defaultVoiceSentiment({ durationMs: 8_000, transcript: words });
    expect(result.label).toBe('pos');
    expect(result.arousal).toBeGreaterThanOrEqual(0.3);
    expect(result.arousal).toBeLessThanOrEqual(0.65);
  });

  it('durationMs=0 → neu, arousal=0, rateWpm=0', () => {
    const result = defaultVoiceSentiment({ durationMs: 0 });
    expect(result.label).toBe('neu');
    expect(result.arousal).toBe(0);
    expect(result.rateWpm).toBe(0);
  });

  it('no transcript → uses 150 wpm baseline (neu, arousal>0.65)', () => {
    // 150 wpm → arousal = (150-90)/80 = 0.75 → fast, long (>3000ms) → neg
    const result = defaultVoiceSentiment({ durationMs: 5_000 });
    expect(result.arousal).toBeCloseTo(0.75, 5);
    expect(result.label).toBe('neg');
    expect(result.reasons.some((r) => r.includes('baseline'))).toBe(true);
  });

  it('reasons array is non-empty', () => {
    const result = defaultVoiceSentiment({ durationMs: 4_000, transcript: 'hi there' });
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ── inferVoiceSentiment ───────────────────────────────────────────────────────

describe('inferVoiceSentiment', () => {
  it('uses provided voiceSentimentFn', async () => {
    const custom: VoiceSentiment = {
      label: 'neg',
      arousal: 0.9,
      rateWpm: 200,
      reasons: ['custom'],
    };
    const router = createMultimodalRouter({
      voiceSentimentFn: () => Promise.resolve(custom),
    });
    const result = await router.inferVoiceSentiment({ durationMs: 5_000 });
    expect(result).toEqual(custom);
  });

  it('falls back to defaultVoiceSentiment when no fn provided', async () => {
    const router = createMultimodalRouter();
    const result = await router.inferVoiceSentiment({
      durationMs: 0,
    });
    expect(result.label).toBe('neu');
    expect(result.arousal).toBe(0);
  });
});

// ── decideReply ───────────────────────────────────────────────────────────────

describe('decideReply', () => {
  it('text input → text reply', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'text', text: 'hello' },
      replyText: 'world',
    });
    expect(d.preferred).toBe('text');
  });

  it('voice input → voice reply (mirror modality)', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
      replyText: 'some reply',
    });
    expect(d.preferred).toBe('voice');
    expect(d.rationale).toMatch(/mirror modality/);
    expect(d.attachOriginalTranscript).toBe(true);
  });

  it('voice input with preferText override → text', () => {
    const router = createMultimodalRouter({ preferText: true });
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
      replyText: 'some reply',
    });
    expect(d.preferred).toBe('text');
    expect(d.rationale).toMatch(/preferText/);
  });

  it('long replyText on text inbound → document', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'text', text: 'summarise' },
      replyText: 'x'.repeat(1_501),
    });
    expect(d.preferred).toBe('document');
    expect(d.rationale).toMatch(/long content/);
  });

  it('replyText exactly at threshold → text (boundary)', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'text' },
      replyText: 'x'.repeat(1_500), // not > 1500
    });
    expect(d.preferred).toBe('text');
  });

  it('voice mirroring wins even when replyText is very long', () => {
    // Design decision: voice mirroring beats long-text document rule.
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 3_000 } },
      replyText: 'x'.repeat(5_000),
    });
    expect(d.preferred).toBe('voice');
  });

  it('ttsHint = fast when energy = high', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
      replyText: 'ok',
      energy: 'high',
    });
    expect(d.ttsHint).toBe('fast');
  });

  it('ttsHint = slow when energy = low', () => {
    const router = createMultimodalRouter();
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
      replyText: 'ok',
      energy: 'low',
    });
    expect(d.ttsHint).toBe('slow');
  });

  it('ttsHint = normal when energy = medium or undefined', () => {
    const router = createMultimodalRouter();
    expect(
      router.decideReply({
        inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
        replyText: 'ok',
        energy: 'medium',
      }).ttsHint,
    ).toBe('normal');
    expect(
      router.decideReply({
        inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
        replyText: 'ok',
      }).ttsHint,
    ).toBe('normal');
  });

  it('unknown/sticker kind → text', () => {
    const router = createMultimodalRouter();
    expect(
      router.decideReply({ inbound: { kind: 'unknown' }, replyText: 'hi' }).preferred,
    ).toBe('text');
    expect(
      router.decideReply({ inbound: { kind: 'sticker' }, replyText: 'hi' }).preferred,
    ).toBe('text');
  });

  it('voiceReplyOnVoice=false → does not mirror voice', () => {
    const router = createMultimodalRouter({ voiceReplyOnVoice: false });
    const d = router.decideReply({
      inbound: { kind: 'voice', voice: { durationMs: 2_000 } },
      replyText: 'short',
    });
    expect(d.preferred).toBe('text');
  });
});

// ── observe ───────────────────────────────────────────────────────────────────

describe('observe', () => {
  it('increments totalsByKind for each observed message', () => {
    const router = createMultimodalRouter();
    const textMsg: InboundMessage = { kind: 'text', text: 'hi' };
    router.observe(textMsg);
    router.observe(textMsg);
    expect(router.stats().totalsByKind.text).toBe(2);
    expect(router.stats().totalsByKind.voice).toBe(0);
  });

  it('voice observe pushes entry to voiceUserHistory', () => {
    const router = createMultimodalRouter({ clock: () => 1_000 });
    router.observe({
      kind: 'voice',
      voice: { durationMs: 4_000 },
      ts: 1_000,
    });
    const h = router.stats().voiceUserHistory;
    expect(h).toHaveLength(1);
    expect(h[0].durationMs).toBe(4_000);
    expect(h[0].ts).toBe(1_000);
    expect(['pos', 'neu', 'neg']).toContain(h[0].sentiment);
  });

  it('voiceUserHistory is capped at 200 entries', () => {
    const router = createMultimodalRouter();
    for (let i = 0; i < 250; i++) {
      router.observe({ kind: 'voice', voice: { durationMs: 1_000 } });
    }
    expect(router.stats().voiceUserHistory).toHaveLength(200);
  });

  it('tracks lastInbound correctly', () => {
    const router = createMultimodalRouter({ clock: () => 42_000 });
    router.observe({ kind: 'photo', ts: 42_000 });
    expect(router.stats().lastInbound).toEqual({ kind: 'photo', ts: 42_000 });
  });
});

// ── enrich ────────────────────────────────────────────────────────────────────

describe('enrich', () => {
  it('photo with captioner returns caption fact', async () => {
    const router = createMultimodalRouter({
      photoCaptioner: async (_photo, _b64) => 'a cat sitting on a chair',
    });
    const msg: InboundMessage = { kind: 'photo', photo: { mimeType: 'image/jpeg' } };
    const { facts } = await router.enrich(msg, {
      fetchBytesBase64: async () => 'base64data',
    });
    expect(facts).toContain('a cat sitting on a chair');
  });

  it('document with extractor returns truncated fact', async () => {
    const bigText = 'A'.repeat(8_000);
    const router = createMultimodalRouter({
      documentExtractor: async () => bigText,
    });
    const msg: InboundMessage = {
      kind: 'document',
      document: { filename: 'report.pdf' },
    };
    const { facts } = await router.enrich(msg);
    expect(facts[0]).toHaveLength(4_000);
    expect(facts[0]).toBe('A'.repeat(4_000));
  });

  it('video with summariser returns fact', async () => {
    const router = createMultimodalRouter({
      videoSummariser: async () => 'person walks into frame',
    });
    const msg: InboundMessage = {
      kind: 'video',
      video: { durationMs: 10_000 },
    };
    const { facts } = await router.enrich(msg);
    expect(facts).toContain('person walks into frame');
  });

  it('voice without transcript invokes transcriber and sets transcript on returned msg', async () => {
    const router = createMultimodalRouter({
      voiceTranscriber: async () => 'hello world',
    });
    const msg: InboundMessage = { kind: 'voice', voice: { durationMs: 3_000 } };
    const { msg: enriched, facts } = await router.enrich(msg);
    expect(enriched.voice?.transcript).toBe('hello world');
    expect(facts.some((f) => f.includes('hello world'))).toBe(true);
  });

  it('voice with existing transcript is not re-transcribed', async () => {
    let called = false;
    const router = createMultimodalRouter({
      voiceTranscriber: async () => {
        called = true;
        return 'new transcript';
      },
    });
    const msg: InboundMessage = {
      kind: 'voice',
      voice: { durationMs: 3_000, transcript: 'existing' },
    };
    const { msg: enriched, facts } = await router.enrich(msg);
    expect(called).toBe(false);
    expect(enriched.voice?.transcript).toBe('existing');
    expect(facts).toHaveLength(0);
  });

  it('enrich without handlers returns unchanged msg and empty facts', async () => {
    const router = createMultimodalRouter();
    const msg: InboundMessage = { kind: 'photo', photo: { bytes: 100 } };
    const { msg: enriched, facts } = await router.enrich(msg);
    expect(facts).toHaveLength(0);
    expect(enriched).toEqual(msg);
  });

  it('handler throwing is swallowed and fact is omitted', async () => {
    const router = createMultimodalRouter({
      photoCaptioner: async () => {
        throw new Error('captioner exploded');
      },
    });
    const msg: InboundMessage = { kind: 'photo', photo: {} };
    await expect(router.enrich(msg)).resolves.toMatchObject({ facts: [] });
  });

  it('documentExtractor throwing → empty facts, no throw', async () => {
    const router = createMultimodalRouter({
      documentExtractor: async () => {
        throw new Error('extraction failed');
      },
    });
    const msg: InboundMessage = { kind: 'document', document: {} };
    const { facts } = await router.enrich(msg);
    expect(facts).toHaveLength(0);
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all stats', () => {
    const router = createMultimodalRouter();
    router.observe({ kind: 'text', text: 'a' });
    router.observe({ kind: 'voice', voice: { durationMs: 2_000 } });
    router.reset();
    const s = router.stats();
    expect(s.totalsByKind.text).toBe(0);
    expect(s.totalsByKind.voice).toBe(0);
    expect(s.voiceUserHistory).toHaveLength(0);
    expect(s.lastInbound).toBeUndefined();
  });
});
