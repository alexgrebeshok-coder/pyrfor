var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { assembleContext } from './context-assembler.js';
import { buildDashboardStateFromExecutiveSnapshot } from './context-snapshot-adapter.js';
import { getServerRuntimeState } from '../config/runtime-mode.js';
export function loadServerAIContext() {
    return __awaiter(this, arguments, void 0, function* (options = {}) {
        var _a, _b, _c;
        const assembled = yield assembleContext({
            projectId: options.projectId,
            locale: options.locale,
            interfaceLocale: options.interfaceLocale,
            includeEvidence: false,
            includeMemory: false,
        });
        const state = buildDashboardStateFromExecutiveSnapshot(assembled.snapshot);
        const activeContext = resolveServerAIContextRef(state, options);
        const project = activeContext.projectId
            ? state.projects.find((item) => item.id === activeContext.projectId)
            : undefined;
        return {
            locale: (_a = options.locale) !== null && _a !== void 0 ? _a : "ru",
            interfaceLocale: (_c = (_b = options.interfaceLocale) !== null && _b !== void 0 ? _b : options.locale) !== null && _c !== void 0 ? _c : "ru",
            generatedAt: assembled.generatedAt,
            activeContext,
            projects: state.projects,
            tasks: state.tasks,
            team: state.team,
            risks: state.risks,
            notifications: [],
            project,
            projectTasks: project
                ? state.tasks.filter((task) => task.projectId === project.id)
                : undefined,
        };
    });
}
export function loadServerDashboardState() {
    return __awaiter(this, void 0, void 0, function* () {
        const runtime = getServerRuntimeState();
        if (!runtime.databaseConfigured) {
            throw new Error("DATABASE_URL is not configured for live mode.");
        }
        const assembled = yield assembleContext({
            includeEvidence: false,
            includeMemory: false,
        });
        return buildDashboardStateFromExecutiveSnapshot(assembled.snapshot);
    });
}
function resolveServerAIContextRef(state, options) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (options.projectId) {
        const project = state.projects.find((item) => item.id === options.projectId);
        if (!project) {
            throw new Error(`Project "${options.projectId}" was not found.`);
        }
        return {
            type: "project",
            pathname: (_a = options.pathname) !== null && _a !== void 0 ? _a : `/projects/${project.id}`,
            title: (_b = options.title) !== null && _b !== void 0 ? _b : project.name,
            subtitle: (_d = (_c = options.subtitle) !== null && _c !== void 0 ? _c : project.description) !== null && _d !== void 0 ? _d : "Meeting-to-action context for the selected project.",
            projectId: project.id,
        };
    }
    return {
        type: "portfolio",
        pathname: (_e = options.pathname) !== null && _e !== void 0 ? _e : "/meetings",
        title: (_f = options.title) !== null && _f !== void 0 ? _f : "Portfolio meeting intake",
        subtitle: (_g = options.subtitle) !== null && _g !== void 0 ? _g : "Meeting-to-action context across the full portfolio.",
    };
}
