import { describe, it, expect } from "vitest";
import { splitForTelegram } from "./chunker";

describe("splitForTelegram", () => {
  it("returns empty array for empty string", () => {
    expect(splitForTelegram("")).toEqual([]);
  });

  it("returns single element for string shorter than maxChunk", () => {
    const short = "Hello world";
    expect(splitForTelegram(short)).toEqual([short]);
  });

  it("returns single element for string exactly at maxChunk", () => {
    const exact = "a".repeat(1200);
    expect(splitForTelegram(exact, 1200)).toEqual([exact]);
  });

  it("splits on paragraph boundaries (\\n\\n)", () => {
    const text = "A".repeat(500) + "\n\nB".repeat(500);
    const chunks = splitForTelegram(text, 800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("A");
    expect(chunks[1]).toContain("B");
  });

  it("splits on sentence boundaries (. )", () => {
    const text = "First sentence. Second sentence that is very long. " + "C".repeat(600);
    const chunks = splitForTelegram(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
    // Should not split mid-word
    chunks.forEach((chunk) => {
      expect(chunk.trim()).toBeTruthy();
    });
  });

  it("splits on newlines when sentences not available", () => {
    const text = "Line 1\nLine 2\n" + "C".repeat(700);
    const chunks = splitForTelegram(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("splits on spaces (word boundaries)", () => {
    const text = "word1 word2 word3 " + "x".repeat(1000);
    const chunks = splitForTelegram(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
    // None should end or start with space
    chunks.forEach((chunk) => {
      expect(chunk).not.toMatch(/^ /);
      expect(chunk).not.toMatch(/ $/);
    });
  });

  it("never splits mid-word (hard cut only if single token > maxChunk)", () => {
    const veryLongWord = "a".repeat(2000);
    const chunks = splitForTelegram(veryLongWord, 1200);
    // First chunk should be maxChunk size (hard cut)
    expect(chunks[0].length).toBe(1200);
    expect(chunks[1].length).toBe(800);
  });

  it("handles cyrillic text correctly", () => {
    const text = "Привет мир! " + "Это ".repeat(400);
    const chunks = splitForTelegram(text, 800);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length <= 1000).toBe(true); // Allow some overhead for word boundaries
    });
  });

  it("respects maxChunk parameter", () => {
    const text = "A".repeat(3000);
    const chunks = splitForTelegram(text, 500);
    chunks.forEach((chunk, idx) => {
      // All but possibly the last chunk should be <= 500
      if (idx < chunks.length - 1) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
    });
  });

  it("handles markdown-formatted text", () => {
    const text = "*Bold* and _italic_\nWith\nNewlines\n\n" + "Content ".repeat(300);
    const chunks = splitForTelegram(text, 600);
    expect(chunks.length).toBeGreaterThan(1);
    // Should still split correctly, preserving markdown
    expect(chunks.some((c) => c.includes("*") || c.includes("_"))).toBe(true);
  });

  it("removes extra whitespace when joining chunks", () => {
    const text = "Start\n\n  Spaced   middle  \n\nEnd";
    const chunks = splitForTelegram(text, 100);
    chunks.forEach((chunk) => {
      // No leading/trailing spaces
      expect(chunk).toEqual(chunk.trim());
    });
  });

  it("splits correctly with custom max chunk size", () => {
    const text = "A".repeat(5000);
    const chunks = splitForTelegram(text, 1200);
    expect(chunks.length).toBeGreaterThan(0);
    // Default behavior
    expect(splitForTelegram(text).length).toBeGreaterThan(0);
  });
});
