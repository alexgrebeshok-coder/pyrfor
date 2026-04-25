var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { extractTouchedPaths } from '../step-validator.js';
const DEFAULT_PUBLIC_API_PATHS = [
    /\/index\.tsx?$/,
    /\/public-api\//,
    /\.d\.ts$/,
];
function isEditOrDeleteEvent(event) {
    var _a;
    if (event.type !== 'tool_call' && event.type !== 'tool_call_update')
        return false;
    const data = event.data;
    const kind = String((_a = data === null || data === void 0 ? void 0 : data['kind']) !== null && _a !== void 0 ? _a : '');
    return kind === 'edit' || kind === 'delete';
}
export function createBreakingChangeValidator(opts) {
    var _a;
    const publicApiPaths = (_a = opts === null || opts === void 0 ? void 0 : opts.publicApiPaths) !== null && _a !== void 0 ? _a : DEFAULT_PUBLIC_API_PATHS;
    return {
        name: 'breaking-change',
        appliesTo(event) {
            return isEditOrDeleteEvent(event);
        },
        validate(event, _ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const start = Date.now();
                const touchedPaths = extractTouchedPaths(event);
                const matchedPaths = touchedPaths.filter((p) => publicApiPaths.some((re) => re.test(p)));
                const durationMs = Date.now() - start;
                if (matchedPaths.length > 0) {
                    return {
                        validator: 'breaking-change',
                        verdict: 'block',
                        message: `Public API file(s) modified: ${matchedPaths.join(', ')}`,
                        details: { matchedPaths, publicApiPaths: publicApiPaths.map((r) => r.source) },
                        remediation: 'Public API changed; confirm with user',
                        durationMs,
                    };
                }
                return {
                    validator: 'breaking-change',
                    verdict: 'pass',
                    message: 'No public API files modified',
                    durationMs,
                };
            });
        },
    };
}
