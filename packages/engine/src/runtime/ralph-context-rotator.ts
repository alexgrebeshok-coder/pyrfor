export interface ContextRotatorOptions {
  maxTokens?: number;
  estimateTokens?: (text: string) => number;
  summariseFn?: (text: string, opts: { maxTokens: number }) => Promise<string> | string;
  summaryMaxTokens?: number;
}

export interface RotationDecision {
  rotate: boolean;
  reason: string;
  tokensEstimated: number;
  summary?: string;
}

export interface ContextRotator {
  shouldRotate(currentContext: string): RotationDecision;
  rotate(currentContext: string): Promise<{ summary: string; tokensEstimated: number }>;
  estimate(text: string): number;
}

export function defaultSummariser(
  text: string,
  opts: { maxTokens: number; estimate: (s: string) => number }
): string {
  const MARKER = '── earlier truncated ──';
  if (!text.trim()) return text;
  if (opts.estimate(text) <= opts.maxTokens) return text;

  const lines = text.split('\n');
  const markerTokens = opts.estimate(MARKER + '\n');
  const lineBudget = opts.maxTokens - markerTokens;

  if (lineBudget <= 0) {
    // Budget too small even for marker; return as many trailing chars as fit
    let tail = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      const candidate = lines[i]! + (tail ? '\n' + tail : '');
      if (opts.estimate(candidate) > opts.maxTokens) break;
      tail = candidate;
    }
    return tail || text.slice(-Math.max(1, Math.floor(text.length * opts.maxTokens / opts.estimate(text))));
  }

  const kept: string[] = [];
  let used = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = opts.estimate(lines[i]! + '\n');
    if (used + lineTokens > lineBudget) break;
    used += lineTokens;
    kept.unshift(lines[i]!);
  }

  if (kept.length === lines.length) return text;
  return MARKER + '\n' + kept.join('\n');
}

export function createContextRotator(opts?: ContextRotatorOptions): ContextRotator {
  const maxTokens = opts?.maxTokens ?? 80_000;
  const summaryMaxTokens = opts?.summaryMaxTokens ?? 800;
  const estimate = opts?.estimateTokens ?? ((text: string) => Math.ceil(text.length / 4));
  const summariseFn = opts?.summariseFn;

  return {
    estimate(text: string): number {
      return estimate(text);
    },

    shouldRotate(currentContext: string): RotationDecision {
      if (!currentContext) {
        return { rotate: false, reason: 'empty context', tokensEstimated: 0 };
      }
      const tokensEstimated = estimate(currentContext);
      if (tokensEstimated > maxTokens) {
        return {
          rotate: true,
          reason: `estimated ${tokensEstimated} tokens exceeds limit ${maxTokens}`,
          tokensEstimated,
        };
      }
      return {
        rotate: false,
        reason: `estimated ${tokensEstimated} tokens within limit ${maxTokens}`,
        tokensEstimated,
      };
    },

    async rotate(currentContext: string): Promise<{ summary: string; tokensEstimated: number }> {
      const tokensEstimated = estimate(currentContext);
      let summary: string;

      if (summariseFn) {
        summary = await Promise.resolve(summariseFn(currentContext, { maxTokens: summaryMaxTokens }));
      } else {
        summary = defaultSummariser(currentContext, {
          maxTokens: summaryMaxTokens,
          estimate,
        });
      }

      // Cap to summaryMaxTokens
      if (estimate(summary) > summaryMaxTokens) {
        const lines = summary.split('\n');
        if (lines.length > 1) {
          // Drop lines from front until it fits
          let start = 0;
          while (start < lines.length && estimate(lines.slice(start).join('\n')) > summaryMaxTokens) {
            start++;
          }
          summary = lines.slice(start).join('\n');
        }
        // If still over (single line or couldn't shrink enough), proportional char trim
        if (estimate(summary) > summaryMaxTokens && summary.length > 0) {
          const ratio = summaryMaxTokens / estimate(summary);
          summary = summary.slice(0, Math.max(0, Math.floor(summary.length * ratio)));
          // Final safety trim
          while (estimate(summary) > summaryMaxTokens && summary.length > 0) {
            summary = summary.slice(0, summary.length - 1);
          }
        }
      }

      return { summary, tokensEstimated };
    },
  };
}
