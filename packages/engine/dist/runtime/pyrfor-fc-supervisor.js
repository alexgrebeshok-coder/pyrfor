/**
 * pyrfor-fc-supervisor.ts
 *
 * Orchestrates FreeClaude (FC) event supervision:
 *   raw FCEvent → FcEventReader → FcEvent[] → FcAcpBridge → AcpEvent[]
 *   → runValidators → ValidatorResult[] → QualityGate → GateDecision
 *
 * The supervisor wires together the existing `step-validator` and
 * `quality-gate` modules with the FC event stream, providing a single
 * `FcSupervisor` interface for callers.
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
import { runValidators, strongestVerdict } from './step-validator.js';
import { FcEventReader } from './pyrfor-event-reader.js';
import { FcAcpBridge } from './pyrfor-fc-event-bridge.js';
// ── Factory ───────────────────────────────────────────────────────────────────
export function createFcSupervisor(opts) {
    var _a;
    const reader = new FcEventReader();
    const bridge = new FcAcpBridge({ sessionId: opts.sessionId });
    const log = (_a = opts.logger) !== null && _a !== void 0 ? _a : (() => { });
    // Mutable stats
    let validatorRuns = 0;
    let totalResults = 0;
    const byVerdict = {
        pass: 0,
        warn: 0,
        correct: 0,
        block: 0,
    };
    const gateDecisions = [];
    let finalEnvelopeVerdict;
    /** Shared ValidatorContext — reused across all events. */
    const ctx = {
        cwd: opts.cwd,
        task: opts.task,
        scopeFiles: opts.scopeFiles,
        abortSignal: opts.abortSignal,
    };
    /**
     * Run validators + gate on a single AcpEvent, update stats, and call
     * callbacks.  Returns accumulated results and optional gate decision.
     */
    function processAcpEvent(acpEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const { verdict, results } = yield runValidators({
                validators: opts.validators,
                event: acpEvent,
                ctx,
                parallel: true,
            });
            if (results.length > 0) {
                validatorRuns++;
                totalResults += results.length;
                for (const r of results) {
                    byVerdict[r.verdict]++;
                }
                (_a = opts.onValidatorResult) === null || _a === void 0 ? void 0 : _a.call(opts, results, verdict);
                log('info', `[supervisor] validators ran`, { type: acpEvent.type, verdict, count: results.length });
            }
            const gateDecision = yield opts.qualityGate.evaluate(acpEvent, results);
            // Only surface non-continue decisions to the caller (reduces noise).
            if (gateDecision.action !== 'continue') {
                gateDecisions.push(gateDecision);
                log('warn', `[supervisor] gate action=${gateDecision.action}`, { reason: gateDecision.reason });
                yield ((_b = opts.onGateDecision) === null || _b === void 0 ? void 0 : _b.call(opts, gateDecision));
                return { results, gateDecision };
            }
            return { results };
        });
    }
    return {
        observe(raw) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                // Short-circuit on abort.
                if ((_a = opts.abortSignal) === null || _a === void 0 ? void 0 : _a.aborted) {
                    return { acp: [], results: [] };
                }
                const fcEvents = reader.read(raw);
                if (fcEvents.length === 0) {
                    return { acp: [], results: [] };
                }
                const acpEvents = bridge.translate(fcEvents);
                if (acpEvents.length === 0) {
                    return { acp: [], results: [] };
                }
                const allResults = [];
                let lastGateDecision;
                for (const acpEvent of acpEvents) {
                    if ((_b = opts.abortSignal) === null || _b === void 0 ? void 0 : _b.aborted)
                        break;
                    const { results, gateDecision } = yield processAcpEvent(acpEvent);
                    allResults.push(...results);
                    if (gateDecision)
                        lastGateDecision = gateDecision;
                }
                return { acp: acpEvents, results: allResults, gateDecision: lastGateDecision };
            });
        },
        finalize(envelope) {
            return __awaiter(this, void 0, void 0, function* () {
                const now = Date.now();
                const syntheticEvents = [];
                // Synthetic diff event covering every file the FC run touched.
                // diff-size / scope-check validators consume this via extractTouchedPaths.
                if (envelope.filesTouched.length > 0) {
                    syntheticEvents.push({
                        sessionId: opts.sessionId,
                        type: 'diff',
                        data: { paths: envelope.filesTouched },
                        ts: now,
                    });
                }
                // Synthetic terminal summary event.
                if (envelope.commandsRun.length > 0) {
                    syntheticEvents.push({
                        sessionId: opts.sessionId,
                        type: 'terminal',
                        data: { commands: envelope.commandsRun, role: 'summary' },
                        ts: now,
                    });
                }
                // Always run at least one synthetic event so session-wide validators
                // (e.g. diff-size with empty scope) get a chance to pass/fail.
                if (syntheticEvents.length === 0) {
                    syntheticEvents.push({
                        sessionId: opts.sessionId,
                        type: 'diff',
                        data: { paths: [] },
                        ts: now,
                    });
                }
                const allResults = [];
                let lastGateDecision;
                for (const acpEvent of syntheticEvents) {
                    const { results, gateDecision } = yield processAcpEvent(acpEvent);
                    allResults.push(...results);
                    if (gateDecision)
                        lastGateDecision = gateDecision;
                }
                const verdict = strongestVerdict(allResults.map((r) => r.verdict));
                finalEnvelopeVerdict = verdict;
                log('info', `[supervisor] finalize verdict=${verdict}`, { files: envelope.filesTouched.length });
                return { results: allResults, verdict, gateDecision: lastGateDecision };
            });
        },
        stats() {
            return {
                validatorRuns,
                totalResults,
                byVerdict: Object.assign({}, byVerdict),
                gateDecisions: [...gateDecisions],
                finalEnvelopeVerdict,
            };
        },
    };
}
