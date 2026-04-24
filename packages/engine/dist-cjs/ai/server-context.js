"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadServerAIContext = loadServerAIContext;
exports.loadServerDashboardState = loadServerDashboardState;
const context_assembler_1 = require("./context-assembler");
const context_snapshot_adapter_1 = require("./context-snapshot-adapter");
const runtime_mode_1 = require("../config/runtime-mode");
async function loadServerAIContext(options = {}) {
    const assembled = await (0, context_assembler_1.assembleContext)({
        projectId: options.projectId,
        locale: options.locale,
        interfaceLocale: options.interfaceLocale,
        includeEvidence: false,
        includeMemory: false,
    });
    const state = (0, context_snapshot_adapter_1.buildDashboardStateFromExecutiveSnapshot)(assembled.snapshot);
    const activeContext = resolveServerAIContextRef(state, options);
    const project = activeContext.projectId
        ? state.projects.find((item) => item.id === activeContext.projectId)
        : undefined;
    return {
        locale: options.locale ?? "ru",
        interfaceLocale: options.interfaceLocale ?? options.locale ?? "ru",
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
}
async function loadServerDashboardState() {
    const runtime = (0, runtime_mode_1.getServerRuntimeState)();
    if (!runtime.databaseConfigured) {
        throw new Error("DATABASE_URL is not configured for live mode.");
    }
    const assembled = await (0, context_assembler_1.assembleContext)({
        includeEvidence: false,
        includeMemory: false,
    });
    return (0, context_snapshot_adapter_1.buildDashboardStateFromExecutiveSnapshot)(assembled.snapshot);
}
function resolveServerAIContextRef(state, options) {
    if (options.projectId) {
        const project = state.projects.find((item) => item.id === options.projectId);
        if (!project) {
            throw new Error(`Project "${options.projectId}" was not found.`);
        }
        return {
            type: "project",
            pathname: options.pathname ?? `/projects/${project.id}`,
            title: options.title ?? project.name,
            subtitle: options.subtitle ??
                project.description ??
                "Meeting-to-action context for the selected project.",
            projectId: project.id,
        };
    }
    return {
        type: "portfolio",
        pathname: options.pathname ?? "/meetings",
        title: options.title ?? "Portfolio meeting intake",
        subtitle: options.subtitle ??
            "Meeting-to-action context across the full portfolio.",
    };
}
