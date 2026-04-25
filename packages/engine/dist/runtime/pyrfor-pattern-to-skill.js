/**
 * pyrfor-pattern-to-skill.ts — Thin connector: mined patterns → FC skills.
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
// ─── Implementation ───────────────────────────────────────────────────────────
/**
 * Convert a mined pattern into an FcSkill with proper frontmatter.
 * Source defaults to 'pyrfor-pattern-miner'.
 */
export function patternToSkill(pattern, opts) {
    var _a, _b;
    const source = (_a = opts === null || opts === void 0 ? void 0 : opts.source) !== null && _a !== void 0 ? _a : 'pyrfor-pattern-miner';
    const createdAt = ((_b = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _b !== void 0 ? _b : (() => new Date()))().toISOString();
    return {
        fm: {
            name: pattern.name,
            description: pattern.description,
            triggers: pattern.triggers,
            source,
            createdAt,
        },
        body: pattern.body,
    };
}
/**
 * Bulk: convert candidates with score >= threshold into skills, write via writer, return paths.
 */
export function emitSkills(candidates, writer, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const minScore = (_a = opts === null || opts === void 0 ? void 0 : opts.minScore) !== null && _a !== void 0 ? _a : 0;
        const paths = [];
        for (const candidate of candidates) {
            if (((_b = candidate.score) !== null && _b !== void 0 ? _b : 0) < minScore)
                continue;
            const skill = patternToSkill(candidate, { source: opts === null || opts === void 0 ? void 0 : opts.source });
            const filePath = yield writer.write(skill);
            paths.push(filePath);
        }
        return paths;
    });
}
