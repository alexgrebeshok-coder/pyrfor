/**
 * export-cli.ts — Pure-logic module for trajectory export.
 *
 * No CLI argument parsing here — that lives in cli.ts.
 * Supports three output formats:
 *   - sharegpt: ShareGPT JSONL (conversations array) ready for LoRA fine-tuning
 *   - jsonl:    Raw TrajectoryRecord objects, one per line
 *   - openai:   OpenAI fine-tune format with tool_calls schema
 */
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
/**
 * Read trajectory records from baseDir, apply filters, serialise to outPath.
 *
 * NOTE: TrajectoryRecorder.query() loads all matching records into an array.
 * This is acceptable for v1 — trajectory files are typically small (<100 k records).
 * In a future revision this should be replaced with a true streaming pipeline
 * that pipes records from the readline interface directly to the write stream.
 */
export declare function exportTrajectoriesToFile(opts: ExportOptions): Promise<ExportResult>;
//# sourceMappingURL=export-cli.d.ts.map