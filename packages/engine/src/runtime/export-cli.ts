/**
 * export-cli.ts — Pure-logic module for trajectory export.
 *
 * No CLI argument parsing here — that lives in cli.ts.
 * Supports three output formats:
 *   - sharegpt: ShareGPT JSONL (conversations array) ready for LoRA fine-tuning
 *   - jsonl:    Raw TrajectoryRecord objects, one per line
 *   - openai:   OpenAI fine-tune format with tool_calls schema
 */

import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { TrajectoryRecorder, type TrajectoryRecord } from './trajectory.js';

// ── Public types ───────────────────────────────────────────────────────────

export interface ExportOptions {
  /** Directory containing trajectory JSONL files. Default: ~/.pyrfor/trajectories */
  baseDir?: string;
  /** Output file path (required). */
  outPath: string;
  /** Output format. */
  format: 'sharegpt' | 'jsonl' | 'openai';
  /** Only include records started on or after this date. */
  since?: Date;
  /** Only include records started on or before this date. */
  until?: Date;
  /** Only include records from this channel. */
  channel?: string;
  /** When true, skip records where success !== true. Default: false */
  successOnly?: boolean;
  /** When false (default), records with private:true are excluded. */
  includePrivate?: boolean;
  /** Skip trajectories with fewer than this many tool calls. */
  minToolCalls?: number;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  outPath: string;
  formatUsed: ExportOptions['format'];
  bytes: number;
}

// ── OpenAI tool_calls schema conversion ───────────────────────────────────

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

function toOpenAIToolCalls(toolCalls: TrajectoryRecord['toolCalls']): OpenAIToolCall[] {
  return toolCalls.map((tc, i) => ({
    id: `call_${i}`,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.args),
    },
  }));
}

// ── Format serialisers ─────────────────────────────────────────────────────

function serializeShareGpt(record: TrajectoryRecord): string {
  const conversations: Array<{ from: string; value: string }> = [
    { from: 'human', value: record.userInput },
  ];
  if (record.toolCalls.length > 0) {
    conversations.push({ from: 'tool_calls', value: JSON.stringify(record.toolCalls) });
  }
  conversations.push({ from: 'gpt', value: record.finalAnswer });
  return JSON.stringify({ conversations });
}

function serializeJsonl(record: TrajectoryRecord): string {
  return JSON.stringify(record);
}

function serializeOpenAI(record: TrajectoryRecord): string {
  const messages: Array<{
    role: string;
    content: string;
    tool_calls?: OpenAIToolCall[];
  }> = [
    { role: 'system', content: 'You are Pyrfor.' },
    { role: 'user', content: record.userInput },
  ];

  const assistantMsg: (typeof messages)[number] = {
    role: 'assistant',
    content: record.finalAnswer,
  };
  if (record.toolCalls.length > 0) {
    assistantMsg.tool_calls = toOpenAIToolCalls(record.toolCalls);
  }
  messages.push(assistantMsg);

  return JSON.stringify({ messages });
}

// ── Main export function ───────────────────────────────────────────────────

/**
 * Read trajectory records from baseDir, apply filters, serialise to outPath.
 *
 * NOTE: TrajectoryRecorder.query() loads all matching records into an array.
 * This is acceptable for v1 — trajectory files are typically small (<100 k records).
 * In a future revision this should be replaced with a true streaming pipeline
 * that pipes records from the readline interface directly to the write stream.
 */
export async function exportTrajectoriesToFile(opts: ExportOptions): Promise<ExportResult> {
  const baseDir = opts.baseDir ?? path.join(os.homedir(), '.pyrfor', 'trajectories');
  const recorder = new TrajectoryRecorder({ baseDir, enabled: true, rotateBy: 'day' });

  // Use query() for filtering supported at that level
  const records = await recorder.query({
    since: opts.since,
    until: opts.until,
    channel: opts.channel,
    successOnly: opts.successOnly,
  });

  // Ensure output parent directory exists (mkdirp)
  const resolvedOut = path.resolve(opts.outPath);
  await fsp.mkdir(path.dirname(resolvedOut), { recursive: true });

  const serialize =
    opts.format === 'sharegpt'
      ? serializeShareGpt
      : opts.format === 'openai'
        ? serializeOpenAI
        : serializeJsonl;

  let exported = 0;
  let skipped = 0;
  let content = '';

  for (const record of records) {
    // Apply filters not handled by query()
    if (!opts.includePrivate && record.private) {
      skipped++;
      continue;
    }
    if (opts.minToolCalls !== undefined && record.toolCalls.length < opts.minToolCalls) {
      skipped++;
      continue;
    }

    content += serialize(record) + '\n';
    exported++;
  }

  // Prompt-free overwrite: caller explicitly invoked the command
  await fsp.writeFile(resolvedOut, content, 'utf8');

  const bytes = Buffer.byteLength(content, 'utf8');
  return { exported, skipped, outPath: resolvedOut, formatUsed: opts.format, bytes };
}
