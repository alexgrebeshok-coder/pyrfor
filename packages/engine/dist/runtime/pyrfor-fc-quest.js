/**
 * pyrfor-fc-quest.ts
 *
 * Quest Mode: orchestrate a chained series of FreeClaude invocations driven by
 * a QuestSpec. Steps run in order; each step can retry on failure.
 *
 * Template substitution supports:
 *   - {{varName}}              → from opts.templateVars
 *   - {{prev.lastFile}}        → last entry of previous envelope.filesTouched
 *   - {{prev.filesTouched}}    → comma-joined previous envelope.filesTouched
 *   - {{step.<id>.sessionId}}  → sessionId from a named prior step's envelope
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
// ── Template resolution ───────────────────────────────────────────────────────
function resolveTemplate(template, templateVars, prevEnvelope, stepEnvelopes) {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
        var _a;
        const k = key.trim();
        // {{prev.lastFile}}
        if (k === 'prev.lastFile') {
            if (!prevEnvelope || prevEnvelope.filesTouched.length === 0)
                return '';
            return prevEnvelope.filesTouched[prevEnvelope.filesTouched.length - 1];
        }
        // {{prev.filesTouched}}
        if (k === 'prev.filesTouched') {
            if (!prevEnvelope)
                return '';
            return prevEnvelope.filesTouched.join(',');
        }
        // {{step.<id>.envelope.sessionId}} or {{step.<id>.sessionId}}
        const stepMatch = k.match(/^step\.([^.]+)(?:\.envelope)?\.sessionId$/);
        if (stepMatch) {
            const stepId = stepMatch[1];
            const env = stepEnvelopes.get(stepId);
            return (_a = env === null || env === void 0 ? void 0 : env.sessionId) !== null && _a !== void 0 ? _a : '';
        }
        // Caller-provided template vars
        if (k in templateVars)
            return templateVars[k];
        return _match; // leave unresolved placeholders as-is
    });
}
// ── Implementation ────────────────────────────────────────────────────────────
export function runQuest(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const { spec, workdir, fcRunner } = opts;
        const templateVars = (_a = opts.templateVars) !== null && _a !== void 0 ? _a : {};
        const stepResults = [];
        const stepEnvelopes = new Map();
        let prevEnvelope = null;
        let questSuccess = true;
        let totalCostUsd = 0;
        for (const step of spec.steps) {
            const maxAttempts = ((_b = step.retries) !== null && _b !== void 0 ? _b : 0) + 1;
            let attempts = 0;
            let lastEnvelope = null;
            let stepSucceeded = false;
            (_c = opts.trajectory) === null || _c === void 0 ? void 0 : _c.append({ type: 'quest_step_start', id: step.id });
            const resolvedPrompt = resolveTemplate(step.prompt, templateVars, prevEnvelope, stepEnvelopes);
            while (attempts < maxAttempts) {
                attempts++;
                const runOpts = Object.assign({ prompt: resolvedPrompt, workdir }, (step.model ? { model: step.model } : {}));
                const handle = fcRunner(runOpts);
                const result = yield handle.complete();
                lastEnvelope = result.envelope;
                totalCostUsd += (_d = lastEnvelope.costUsd) !== null && _d !== void 0 ? _d : 0;
                if (step.successCriteria) {
                    const ok = yield step.successCriteria(lastEnvelope);
                    if (ok) {
                        stepSucceeded = true;
                        break;
                    }
                }
                else {
                    stepSucceeded = lastEnvelope.status !== 'error';
                    if (stepSucceeded)
                        break;
                }
            }
            const stepResult = {
                id: step.id,
                envelope: lastEnvelope,
                attempts,
                success: stepSucceeded,
            };
            stepResults.push(stepResult);
            stepEnvelopes.set(step.id, lastEnvelope);
            prevEnvelope = lastEnvelope;
            (_e = opts.trajectory) === null || _e === void 0 ? void 0 : _e.append({
                type: 'quest_step_end',
                id: step.id,
                success: stepSucceeded,
                attempts,
            });
            if (!stepSucceeded) {
                questSuccess = false;
                break;
            }
        }
        return {
            name: spec.name,
            steps: stepResults,
            success: questSuccess,
            totalCostUsd,
        };
    });
}
