import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VIDEO_EXTENSIONS,
  asImageSource,
  extractKeyFrame,
  extractSampleFrames,
  isFrameExtractionEnabled,
  looksLikeVideoUrl,
  pickSampleOffsets,
  verifyClipWithVision,
  type ExtractedFrame,
} from "@/lib/ai/multimodal/frame-extractor";
import { MockVisionProvider, VisionRouter } from "@/lib/ai/multimodal/vision";

const ORIGINAL_ENABLE = process.env.ENABLE_VIDEO_FRAME_EXTRACTION;

function restore() {
  if (ORIGINAL_ENABLE === undefined) {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
  } else {
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = ORIGINAL_ENABLE;
  }
}

describe("frame-extractor helpers", () => {
  beforeEach(() => {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
  });

  afterEach(() => {
    restore();
  });

  it("isFrameExtractionEnabled respects env variants", () => {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    expect(isFrameExtractionEnabled()).toBe(false);
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = "true";
    expect(isFrameExtractionEnabled()).toBe(true);
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = "1";
    expect(isFrameExtractionEnabled()).toBe(true);
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = "no";
    expect(isFrameExtractionEnabled()).toBe(false);
  });

  it("looksLikeVideoUrl picks up common extensions and mime types", () => {
    expect(looksLikeVideoUrl("https://x.com/a.mp4", null)).toBe(true);
    expect(looksLikeVideoUrl("https://x.com/a.MOV", null)).toBe(true);
    expect(looksLikeVideoUrl("https://x.com/a.webm", null)).toBe(true);
    expect(looksLikeVideoUrl("https://x.com/a.jpg", null)).toBe(false);
    expect(looksLikeVideoUrl("https://x.com/a.bin", "video/mp4")).toBe(true);
    expect(looksLikeVideoUrl("not-a-url", "video/webm")).toBe(true);
    expect(looksLikeVideoUrl("not-a-url", null)).toBe(false);
  });

  it("VIDEO_EXTENSIONS contains expected formats", () => {
    expect(VIDEO_EXTENSIONS.has("mp4")).toBe(true);
    expect(VIDEO_EXTENSIONS.has("mov")).toBe(true);
    expect(VIDEO_EXTENSIONS.has("webm")).toBe(true);
    expect(VIDEO_EXTENSIONS.has("jpg")).toBe(false);
  });

  it("asImageSource wraps an extracted frame as a base64 ImageSource", () => {
    const frame: ExtractedFrame = {
      data: "ZmFrZQ==",
      mimeType: "image/jpeg",
      timestampSeconds: 1,
      sizeBytes: 4,
    };
    const src = asImageSource(frame);
    expect(src).toEqual({
      kind: "base64",
      data: "ZmFrZQ==",
      mimeType: "image/jpeg",
    });
  });

  it("extractKeyFrame returns null when disabled by env", async () => {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    const result = await extractKeyFrame("https://example.com/clip.mp4");
    expect(result).toBeNull();
  });

  it("extractKeyFrame returns null when the source url is empty", async () => {
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = "true";
    const result = await extractKeyFrame("");
    expect(result).toBeNull();
  });
});

describe("pickSampleOffsets", () => {
  it("returns default ladder when duration is unknown", () => {
    expect(pickSampleOffsets(3)).toEqual([1, 5, 15]);
    expect(pickSampleOffsets(1)).toEqual([1]);
    expect(pickSampleOffsets(5)).toEqual([1, 5, 15, 30, 60]);
  });

  it("spreads offsets across the clip when duration is known", () => {
    const offsets = pickSampleOffsets(3, 100);
    expect(offsets).toHaveLength(3);
    // 10% / 50% / 90% of 100s → 10, 50, 90
    expect(offsets[0]).toBeCloseTo(10, 1);
    expect(offsets[1]).toBeCloseTo(50, 1);
    expect(offsets[2]).toBeCloseTo(90, 1);
  });

  it("caps sample count at 5 to keep cost bounded", () => {
    expect(pickSampleOffsets(10, 100)).toHaveLength(5);
  });
});

describe("extractSampleFrames (disabled env)", () => {
  const origEnable = process.env.ENABLE_VIDEO_FRAME_EXTRACTION;

  afterEach(() => {
    if (origEnable === undefined) {
      delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    } else {
      process.env.ENABLE_VIDEO_FRAME_EXTRACTION = origEnable;
    }
  });

  it("returns [] when the feature flag is off", async () => {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    const frames = await extractSampleFrames("https://x.com/a.mp4", { sampleCount: 3 });
    expect(frames).toEqual([]);
  });

  it("returns [] for an empty URL even when enabled", async () => {
    process.env.ENABLE_VIDEO_FRAME_EXTRACTION = "true";
    const frames = await extractSampleFrames("", { sampleCount: 2 });
    expect(frames).toEqual([]);
  });
});

describe("verifyClipWithVision (flag off)", () => {
  const origEnable = process.env.ENABLE_VIDEO_FRAME_EXTRACTION;

  afterEach(() => {
    if (origEnable === undefined) {
      delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    } else {
      process.env.ENABLE_VIDEO_FRAME_EXTRACTION = origEnable;
    }
  });

  it("returns null when frame extraction is disabled", async () => {
    delete process.env.ENABLE_VIDEO_FRAME_EXTRACTION;
    const router = new VisionRouter([new MockVisionProvider()]);
    const result = await verifyClipWithVision("https://x.com/a.mp4", "claim", router);
    expect(result).toBeNull();
  });
});
