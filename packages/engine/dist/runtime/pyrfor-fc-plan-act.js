/**
 * pyrfor-fc-plan-act.ts
 *
 * Two-stage orchestration: a planning model produces a numbered plan, then an
 * execution model carries it out.
 *
 * Text extraction contract:
 *   fcRunner is expected to return an FCEnvelope whose `raw` field has a
 *   `lastAssistantText` property (string) populated by the caller/test stub.
 *   This module reads `envelope.raw.lastAssistantText` to extract the plan.
 *   If absent, it falls back to `String(envelope.output ?? '')`.
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
// ── Helpers ───────────────────────────────────────────────────────────────────
const DEFAULT_PLAN_SYSTEM_PROMPT = 'You are a planning model. Output a numbered plan only.';
function defaultParsePlan(text) {
    return text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\d+[\.\)]\s+/.test(l))
        .map((l) => l.replace(/^\d+[\.\)]\s+/, '').trim());
}
function extractText(envelope) {
    var _a;
    if (envelope.raw && typeof envelope.raw.lastAssistantText === 'string') {
        return envelope.raw.lastAssistantText;
    }
    return String((_a = envelope.output) !== null && _a !== void 0 ? _a : '');
}
// ── Implementation ────────────────────────────────────────────────────────────
export function runPlanAct(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const planSystemPrompt = (_a = opts.planSystemPrompt) !== null && _a !== void 0 ? _a : DEFAULT_PLAN_SYSTEM_PROMPT;
        const parsePlan = (_b = opts.parsePlan) !== null && _b !== void 0 ? _b : defaultParsePlan;
        // ── Stage 1: Plan ──────────────────────────────────────────────────────────
        (_c = opts.trajectory) === null || _c === void 0 ? void 0 : _c.append({ type: 'plan_act_stage_start', stage: 'plan', model: opts.planModel });
        const planOpts = {
            prompt: opts.task,
            workdir: opts.workdir,
            model: opts.planModel,
            systemPrompt: planSystemPrompt,
        };
        const planHandle = opts.fcRunner(planOpts);
        const planResult = yield planHandle.complete();
        const planEnvelope = planResult.envelope;
        (_d = opts.trajectory) === null || _d === void 0 ? void 0 : _d.append({ type: 'plan_act_stage_end', stage: 'plan', envelope: planEnvelope });
        if (planEnvelope.status === 'error') {
            throw new Error(`Plan stage failed: ${(_e = planEnvelope.error) !== null && _e !== void 0 ? _e : 'unknown error'}`);
        }
        const rawText = extractText(planEnvelope);
        const plan = parsePlan(rawText);
        // ── Stage 2: Act ───────────────────────────────────────────────────────────
        const actPrompt = [
            opts.task,
            '',
            'PLAN:',
            plan.map((s, i) => `${i + 1}. ${s}`).join('\n'),
            '',
            'Execute the plan now.',
        ].join('\n');
        (_f = opts.trajectory) === null || _f === void 0 ? void 0 : _f.append({ type: 'plan_act_stage_start', stage: 'act', model: opts.actModel, plan });
        const actOpts = Object.assign({ prompt: actPrompt, workdir: opts.workdir, model: opts.actModel }, (opts.actSystemPrompt ? { systemPrompt: opts.actSystemPrompt } : {}));
        const actHandle = opts.fcRunner(actOpts);
        const actResult = yield actHandle.complete();
        const actEnvelope = actResult.envelope;
        (_g = opts.trajectory) === null || _g === void 0 ? void 0 : _g.append({ type: 'plan_act_stage_end', stage: 'act', envelope: actEnvelope });
        const totalCostUsd = ((_h = planEnvelope.costUsd) !== null && _h !== void 0 ? _h : 0) + ((_j = actEnvelope.costUsd) !== null && _j !== void 0 ? _j : 0);
        return { plan, planEnvelope, actEnvelope, totalCostUsd };
    });
}
