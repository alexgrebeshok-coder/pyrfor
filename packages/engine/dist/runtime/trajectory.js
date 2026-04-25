/**
 * trajectory.ts — Pyrfor self-improvement trajectory recorder.
 *
 * Records every pipeline run (tool calls, tokens, answer) as a JSONL line so
 * future phases (pattern miner, auto-skill synthesis, fine-tune export) can
 * learn from real usage.
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
import { promises as fsp, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import crypto from 'crypto';
// ── Helpers ────────────────────────────────────────────────────────────────
function generateId() {
    return Date.now().toString(36) + crypto.randomBytes(10).toString('hex');
}
function formatDate(d) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function isoWeekLabel(d) {
    const date = new Date(d.getTime());
    date.setUTCHours(0, 0, 0, 0);
    // ISO week: Thursday of the current week determines the year
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const year = date.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekNum = 1 +
        Math.round(((date.getTime() - jan4.getTime()) / 86400000 -
            3 +
            ((jan4.getUTCDay() + 6) % 7)) /
            7);
    return `${year}-${String(weekNum).padStart(2, '0')}`;
}
function fileSuffix(d, rotateBy) {
    return rotateBy === 'day' ? formatDate(d) : isoWeekLabel(d);
}
// ── Per-path mutex ─────────────────────────────────────────────────────────
const mutexMap = new Map();
function withMutex(key, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const prev = (_a = mutexMap.get(key)) !== null && _a !== void 0 ? _a : Promise.resolve();
        let resolveMine;
        const mine = new Promise((res) => {
            resolveMine = res;
        });
        mutexMap.set(key, mine);
        yield prev;
        try {
            return yield fn();
        }
        finally {
            resolveMine();
            if (mutexMap.get(key) === mine)
                mutexMap.delete(key);
        }
    });
}
// ── TrajectoryRecorder ─────────────────────────────────────────────────────
export class TrajectoryRecorder {
    constructor(opts) {
        this._activeCount = 0;
        this.opts = Object.assign({ baseDir: path.join(os.homedir(), '.pyrfor', 'trajectories'), enabled: true, rotateBy: 'day' }, opts);
    }
    /** Currently-active builders count (for tests / observability). */
    activeCount() {
        return this._activeCount;
    }
    /** Begin recording a pipeline run. Returns a builder. */
    begin(input) {
        if (!this.opts.enabled)
            return noopBuilder();
        const startedAt = new Date().toISOString();
        const id = generateId();
        const toolCalls = [];
        let provider;
        let model;
        let tokensUsed = { prompt: 0, completion: 0, total: 0 };
        let finished = false;
        let cancelled = false;
        this._activeCount++;
        const recorder = this;
        return {
            recordToolCall(call) {
                if (!finished && !cancelled)
                    toolCalls.push(call);
            },
            setProvider(p, m) {
                provider = p;
                model = m;
            },
            addTokens({ prompt = 0, completion = 0 }) {
                tokensUsed = {
                    prompt: tokensUsed.prompt + prompt,
                    completion: tokensUsed.completion + completion,
                    total: tokensUsed.total + prompt + completion,
                };
            },
            finish(_a) {
                return __awaiter(this, arguments, void 0, function* ({ finalAnswer, success = true, abortReason, costUsd, iterations = 0 }) {
                    var _b;
                    if (finished || cancelled) {
                        throw new Error('TrajectoryBuilder already finished or cancelled');
                    }
                    finished = true;
                    recorder._activeCount--;
                    const completedAt = new Date().toISOString();
                    const record = {
                        id,
                        sessionId: input.sessionId,
                        channel: input.channel,
                        userId: input.userId,
                        chatId: input.chatId,
                        userInput: input.userInput,
                        toolCalls,
                        finalAnswer,
                        success,
                        abortReason,
                        iterations,
                        tokensUsed,
                        costUsd,
                        provider,
                        model,
                        startedAt,
                        completedAt,
                        durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
                        private: (_b = input.private) !== null && _b !== void 0 ? _b : false,
                        metadata: input.metadata,
                    };
                    yield recorder._writeRecord(record);
                    return record;
                });
            },
            cancel() {
                if (!finished && !cancelled) {
                    cancelled = true;
                    recorder._activeCount--;
                }
            },
        };
    }
    _writeRecord(record) {
        return __awaiter(this, void 0, void 0, function* () {
            const dir = this.opts.baseDir;
            yield fsp.mkdir(dir, { recursive: true });
            const suffix = fileSuffix(new Date(record.startedAt), this.opts.rotateBy);
            const baseKey = path.join(dir, `trajectories-${suffix}`);
            const line = JSON.stringify(record) + '\n';
            // Acquire mutex on base key so size check + append are atomic per process
            yield withMutex(baseKey, () => __awaiter(this, void 0, void 0, function* () {
                let filePath;
                if (this.opts.maxFileSizeMb !== undefined) {
                    filePath = yield this._resolveRotatedPath(dir, suffix, this.opts.maxFileSizeMb);
                }
                else {
                    filePath = `${baseKey}.jsonl`;
                }
                yield fsp.appendFile(filePath, line, 'utf8');
            }));
        });
    }
    _resolveRotatedPath(dir, suffix, maxMb) {
        return __awaiter(this, void 0, void 0, function* () {
            const maxBytes = maxMb * 1024 * 1024;
            let n = 0;
            for (;;) {
                const candidate = n === 0
                    ? path.join(dir, `trajectories-${suffix}.jsonl`)
                    : path.join(dir, `trajectories-${suffix}-${n}.jsonl`);
                try {
                    const stat = yield fsp.stat(candidate);
                    if (stat.size < maxBytes)
                        return candidate;
                    n++;
                }
                catch (_a) {
                    return candidate; // file doesn't exist yet
                }
            }
        });
    }
    /** Read all trajectories matching predicates (date range, channel, success). */
    query(filter) {
        return __awaiter(this, void 0, void 0, function* () {
            const dir = this.opts.baseDir;
            let files;
            try {
                files = yield fsp.readdir(dir);
            }
            catch (_a) {
                return [];
            }
            files = files
                .filter((f) => f.startsWith('trajectories-') && f.endsWith('.jsonl'))
                .sort();
            const results = [];
            const limit = filter === null || filter === void 0 ? void 0 : filter.limit;
            for (const file of files) {
                if (limit !== undefined && results.length >= limit)
                    break;
                const fileRecords = yield this._readFile(path.join(dir, file));
                for (const record of fileRecords) {
                    if (limit !== undefined && results.length >= limit)
                        break;
                    if ((filter === null || filter === void 0 ? void 0 : filter.since) && new Date(record.startedAt) < filter.since)
                        continue;
                    if ((filter === null || filter === void 0 ? void 0 : filter.until) && new Date(record.startedAt) > filter.until)
                        continue;
                    if ((filter === null || filter === void 0 ? void 0 : filter.channel) && record.channel !== filter.channel)
                        continue;
                    if ((filter === null || filter === void 0 ? void 0 : filter.successOnly) && !record.success)
                        continue;
                    results.push(record);
                }
            }
            return results;
        });
    }
    _readFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const records = [];
            let stream;
            try {
                stream = createReadStream(filePath, { encoding: 'utf8' });
                const rl = createInterface({ input: stream, crlfDelay: Infinity });
                yield new Promise((resolve, reject) => {
                    rl.on('line', (line) => {
                        const trimmed = line.trim();
                        if (!trimmed)
                            return;
                        try {
                            records.push(JSON.parse(trimmed));
                        }
                        catch (_a) {
                            // skip malformed lines
                        }
                    });
                    rl.on('close', resolve);
                    rl.on('error', reject);
                    stream.on('error', reject);
                });
            }
            catch (_a) {
                // file vanished or is unreadable — return empty
            }
            return records;
        });
    }
    /**
     * Stream JSONL → ShareGPT-formatted JSONL for fine-tuning.
     * Excludes private:true and success:false records.
     */
    exportShareGpt(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const records = yield this.query({ since: opts.since, until: opts.until });
            const outDir = path.dirname(opts.outPath);
            yield fsp.mkdir(outDir, { recursive: true });
            const writer = createWriteStream(opts.outPath, { flags: 'w', encoding: 'utf8' });
            let exported = 0;
            let skipped = 0;
            yield new Promise((resolve, reject) => {
                writer.on('error', reject);
                writer.on('finish', resolve);
                for (const record of records) {
                    if (record.private || !record.success) {
                        skipped++;
                        continue;
                    }
                    const conversations = [
                        { from: 'human', value: record.userInput },
                    ];
                    if (record.toolCalls.length > 0) {
                        conversations.push({
                            from: 'tool_calls',
                            value: JSON.stringify(record.toolCalls),
                        });
                    }
                    conversations.push({ from: 'gpt', value: record.finalAnswer });
                    writer.write(JSON.stringify({ conversations }) + '\n');
                    exported++;
                }
                writer.end();
            });
            return { exported, skipped };
        });
    }
    /** Delete trajectory files older than retainDays. */
    pruneOld(retainDays) {
        return __awaiter(this, void 0, void 0, function* () {
            const dir = this.opts.baseDir;
            let files;
            try {
                files = yield fsp.readdir(dir);
            }
            catch (_a) {
                return { deleted: 0 };
            }
            const cutoff = new Date();
            cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);
            cutoff.setUTCHours(0, 0, 0, 0);
            let deleted = 0;
            for (const file of files) {
                if (!file.startsWith('trajectories-') || !file.endsWith('.jsonl'))
                    continue;
                const fileDate = parseDateFromFilename(file);
                if (fileDate !== null && fileDate < cutoff) {
                    try {
                        yield fsp.unlink(path.join(dir, file));
                        deleted++;
                    }
                    catch (_b) {
                        // file already gone
                    }
                }
            }
            return { deleted };
        });
    }
}
// ── Filename date parsing ──────────────────────────────────────────────────
function parseDateFromFilename(filename) {
    // Daily: trajectories-YYYY-MM-DD.jsonl or trajectories-YYYY-MM-DD-N.jsonl
    const daily = filename.match(/^trajectories-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.jsonl$/);
    if (daily)
        return new Date(daily[1] + 'T00:00:00Z');
    // Weekly: trajectories-YYYY-WW.jsonl or trajectories-YYYY-WW-N.jsonl
    const weekly = filename.match(/^trajectories-(\d{4})-(\d{2})(?:-\d+)?\.jsonl$/);
    if (weekly) {
        const year = parseInt(weekly[1], 10);
        const week = parseInt(weekly[2], 10);
        // ISO week 1 contains Jan 4
        const jan4 = new Date(Date.UTC(year, 0, 4));
        const dayOfWeek = (jan4.getUTCDay() + 6) % 7; // 0=Mon
        const weekStart = new Date(jan4.getTime() - dayOfWeek * 86400000 + (week - 1) * 7 * 86400000);
        return weekStart;
    }
    return null;
}
// ── Noop builder (disabled mode) ──────────────────────────────────────────
function noopBuilder() {
    return {
        recordToolCall() { },
        setProvider() { },
        addTokens() { },
        finish(_a) {
            return __awaiter(this, arguments, void 0, function* ({ finalAnswer }) {
                return {
                    id: '',
                    sessionId: '',
                    channel: '',
                    userInput: '',
                    toolCalls: [],
                    finalAnswer,
                    success: true,
                    iterations: 0,
                    tokensUsed: { prompt: 0, completion: 0, total: 0 },
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    durationMs: 0,
                    private: false,
                };
            });
        },
        cancel() { },
    };
}
