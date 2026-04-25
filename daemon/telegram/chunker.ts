/**
 * Telegram Message Chunker
 *
 * Splits long messages into 800-1200 char chunks at sentence/paragraph boundaries
 * to avoid Telegram's 4096 char limit and improve readability.
 *
 * Algorithm:
 * 1. Try to split on paragraph breaks (\n\n)
 * 2. Then on sentence boundaries (". ")
 * 3. Then on newlines (\n)
 * 4. Then on spaces
 * 5. Finally hard-cut if a single token > maxChunk
 *
 * Never cuts mid-word.
 */

export function splitForTelegram(text: string, maxChunk: number = 1200): string[] {
  if (!text || text.length === 0) {
    return [];
  }

  if (text.length <= maxChunk) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining);
      break;
    }

    // Try to find the best split point within maxChunk
    const chunk = remaining.substring(0, maxChunk);
    let splitPos = -1;

    // 1. Try paragraph break
    splitPos = chunk.lastIndexOf("\n\n");
    if (splitPos > 0 && splitPos > maxChunk * 0.6) {
      splitPos += 2; // Include the \n\n
    } else {
      splitPos = -1;
    }

    // 2. Try sentence boundary (". " or ".\n")
    if (splitPos === -1) {
      const sentenceMatch = chunk.lastIndexOf(". ");
      const sentenceNewline = chunk.lastIndexOf(".\n");
      splitPos = Math.max(sentenceMatch, sentenceNewline);

      if (splitPos > 0 && splitPos > maxChunk * 0.6) {
        splitPos += sentenceMatch > sentenceNewline ? 2 : 2; // Include ". " or ".\n"
      } else {
        splitPos = -1;
      }
    }

    // 3. Try newline
    if (splitPos === -1) {
      splitPos = chunk.lastIndexOf("\n");
      if (splitPos > 0 && splitPos > maxChunk * 0.6) {
        splitPos += 1;
      } else {
        splitPos = -1;
      }
    }

    // 4. Try space (word boundary)
    if (splitPos === -1) {
      splitPos = chunk.lastIndexOf(" ");
      if (splitPos > 0 && splitPos > maxChunk * 0.6) {
        splitPos += 1;
      } else {
        splitPos = -1;
      }
    }

    // 5. Hard cut if no good boundary found (shouldn't happen often with reasonable text)
    if (splitPos === -1) {
      splitPos = maxChunk;
    }

    chunks.push(remaining.substring(0, splitPos).trim());
    remaining = remaining.substring(splitPos).trim();
  }

  return chunks.filter((c) => c.length > 0);
}
