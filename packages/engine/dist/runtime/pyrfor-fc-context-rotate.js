var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ─── rotateContext ────────────────────────────────────────────────────────────
export function rotateContext(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { iter, history, basePrompt, lessonsBuilder } = input;
        // Iteration 1: no context rotation needed
        if (iter === 1 || history.length === 0) {
            return { prompt: basePrompt };
        }
        const prev = history[history.length - 1];
        const prevScore = prev.score.total;
        const breakdownStr = JSON.stringify(prev.score.breakdown);
        const correctionNote = `[ITERATION ${iter}] Previous score: ${prevScore}/100. Failures: ${breakdownStr}. Address these specifically.`;
        const lightNote = `[ITERATION ${iter}] Previous score: ${prevScore}/100. Continue improving.`;
        // Lessons prefix (if builder provided)
        let lessonsPrefix = '';
        if (lessonsBuilder) {
            const lessons = yield lessonsBuilder();
            if (lessons) {
                lessonsPrefix = `${lessons}\n\n`;
            }
        }
        const prevSessionId = (_a = prev.envelope.sessionId) !== null && _a !== void 0 ? _a : undefined;
        if (prevScore < 50) {
            // Fresh start: no resume, corrections + lessons in appendSystemPrompt
            const appendSystemPrompt = lessonsPrefix + correctionNote;
            return {
                prompt: basePrompt,
                appendSystemPrompt: appendSystemPrompt || undefined,
            };
        }
        else if (prevScore < 80) {
            // Resume previous session + correction note
            return {
                prompt: basePrompt,
                resumeSessionId: prevSessionId,
                appendSystemPrompt: lessonsPrefix + correctionNote,
            };
        }
        else {
            // Score >= 80: light append + resume
            const appendSystemPrompt = lessonsPrefix + lightNote;
            return {
                prompt: basePrompt,
                resumeSessionId: prevSessionId,
                appendSystemPrompt: appendSystemPrompt || undefined,
            };
        }
    });
}
