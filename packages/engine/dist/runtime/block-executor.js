var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { access } from 'node:fs/promises';
import path from 'node:path';
import { execCommand } from './tools.js';
export function executeBlockMain(entry_1) {
    return __awaiter(this, arguments, void 0, function* (entry, options = {}) {
        var _a, _b;
        const blockId = entry.blockId;
        const rootDir = entry.rootDir;
        if (!rootDir) {
            return { ok: false, blockId, status: 'error', error: 'block registry entry missing rootDir' };
        }
        const mainRel = (_a = entry.manifest.entrypoints.main) === null || _a === void 0 ? void 0 : _a.trim();
        if (!mainRel) {
            return { ok: false, blockId, status: 'error', error: 'block manifest missing entrypoints.main' };
        }
        const mainPath = path.join(rootDir, mainRel);
        try {
            yield access(mainPath);
        }
        catch (_c) {
            return { ok: false, blockId, status: 'error', error: `entrypoint not found: ${mainRel}` };
        }
        const envPrefix = options.input
            ? `PYRFOR_BLOCK_INPUT=${JSON.stringify(JSON.stringify(options.input))} `
            : '';
        const command = `${envPrefix}node ${JSON.stringify(mainPath)}`;
        const execResult = yield execCommand(command, {
            timeout: (_b = options.timeoutMs) !== null && _b !== void 0 ? _b : 60000,
        }, Object.assign(Object.assign({}, options.toolContext), { execRoot: rootDir, runId: options.runId }));
        const payload = {
            ok: execResult.success,
            blockId,
            status: execResult.success ? 'completed' : 'error',
            exitCode: execResult.data.exitCode,
            stdout: execResult.data.stdout,
            stderr: execResult.data.stderr,
            error: execResult.error,
        };
        if (options.artifactStore) {
            payload.resultRef = yield options.artifactStore.writeJSON('block_load_result', payload, {
                runId: options.runId,
                meta: { blockId, projectId: options.projectId, status: payload.status },
            });
        }
        if (!payload.ok && options.ledger && options.runId) {
            yield options.ledger.append({
                type: 'block.error',
                run_id: options.runId,
                block_id: blockId,
                project_id: options.projectId,
                status: 'error',
                error: payload.error,
            });
        }
        return payload;
    });
}
export function blockExecuteToToolResult(result) {
    return {
        success: result.ok,
        data: result,
        error: result.error,
    };
}
