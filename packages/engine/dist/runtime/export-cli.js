/**
 * export-cli.ts — Pure-logic module for trajectory export.
 *
 * No CLI argument parsing here — that lives in cli.ts.
 * Supports three output formats:
 *   - sharegpt: ShareGPT JSONL (conversations array) ready for LoRA fine-tuning
 *   - jsonl:    Raw TrajectoryRecord objects, one per line
 *   - openai:   OpenAI fine-tune format with tool_calls schema
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { TrajectoryRecorder } from './trajectory.js';
function toOpenAIToolCalls(toolCalls) {
    return toolCalls.map((tc, i) => ({
        id: `call_${i}`,
        type: 'function',
        function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
        },
    }));
}
// ── Format serialisers ─────────────────────────────────────────────────────
function serializeShareGpt(record) {
    const conversations = [
        { from: 'human', value: record.userInput },
    ];
    if (record.toolCalls.length > 0) {
        conversations.push({ from: 'tool_calls', value: JSON.stringify(record.toolCalls) });
    }
    conversations.push({ from: 'gpt', value: record.finalAnswer });
    return JSON.stringify({ conversations });
}
function serializeJsonl(record) {
    return JSON.stringify(record);
}
function serializeOpenAI(record) {
    const messages = [
        { role: 'system', content: 'You are Pyrfor.' },
        { role: 'user', content: record.userInput },
    ];
    const assistantMsg = {
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
export function exportTrajectoriesToFile(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const baseDir = (_a = opts.baseDir) !== null && _a !== void 0 ? _a : path.join(os.homedir(), '.pyrfor', 'trajectories');
        const recorder = new TrajectoryRecorder({ baseDir, enabled: true, rotateBy: 'day' });
        // Use query() for filtering supported at that level
        const records = yield recorder.query({
            since: opts.since,
            until: opts.until,
            channel: opts.channel,
            successOnly: opts.successOnly,
        });
        // Ensure output parent directory exists (mkdirp)
        const resolvedOut = path.resolve(opts.outPath);
        yield fsp.mkdir(path.dirname(resolvedOut), { recursive: true });
        const serialize = opts.format === 'sharegpt'
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
        yield fsp.writeFile(resolvedOut, content, 'utf8');
        const bytes = Buffer.byteLength(content, 'utf8');
        return { exported, skipped, outPath: resolvedOut, formatUsed: opts.format, bytes };
    });
}
