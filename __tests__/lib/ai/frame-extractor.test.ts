import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VIDEO_EXTENSIONS,
  asImageSource,
  extractKeyFrame,
  isFrameExtractionEnabled,
  looksLikeVideoUrl,
  type ExtractedFrame,
} from "@/lib/ai/multimodal/frame-extractor";

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
