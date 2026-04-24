"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulingToolService = void 0;
const critical_path_1 = require("../../scheduling/critical-path");
const resource_leveling_1 = require("../../scheduling/resource-leveling");
const service_1 = require("../../scheduling/service");
const shared_1 = require("./shared");
exports.schedulingToolService = {
    async getCriticalPath(toolCallId, args) {
        const projectId = await (0, shared_1.resolveActiveProjectId)(args.projectId);
        if (!projectId) {
            return {
                toolCallId,
                name: "get_critical_path",
                success: false,
                result: { error: "No project found" },
                displayMessage: "❌ Нет доступного проекта для расчёта критического пути",
            };
        }
        const context = await (0, service_1.getProjectSchedulingContext)(projectId);
        if (!context) {
            return {
                toolCallId,
                name: "get_critical_path",
                success: false,
                result: { error: `Project ${projectId} not found` },
                displayMessage: `❌ Проект ${projectId} не найден`,
            };
        }
        const criticalPath = (0, critical_path_1.calculateCriticalPath)({
            tasks: context.tasks,
            dependencies: context.dependencies,
            projectStart: context.project.start,
        });
        const criticalTasks = criticalPath.tasks.filter((task) => task.isCritical);
        return {
            toolCallId,
            name: "get_critical_path",
            success: true,
            result: {
                projectId,
                projectFinish: criticalPath.projectFinish.toISOString(),
                criticalPath: criticalPath.criticalPath,
                criticalTasks,
            },
            displayMessage: `🧭 Критический путь рассчитан: ${criticalTasks.length} критических задач, финиш ${criticalPath.projectFinish.toLocaleDateString("ru-RU")}`,
        };
    },
    async getResourceLoad(toolCallId, args) {
        const projectId = await (0, shared_1.resolveActiveProjectId)(args.projectId);
        if (!projectId) {
            return {
                toolCallId,
                name: "get_resource_load",
                success: false,
                result: { error: "No project found" },
                displayMessage: "❌ Нет доступного проекта для расчёта загрузки ресурсов",
            };
        }
        const context = await (0, service_1.getProjectSchedulingContext)(projectId);
        if (!context) {
            return {
                toolCallId,
                name: "get_resource_load",
                success: false,
                result: { error: `Project ${projectId} not found` },
                displayMessage: `❌ Проект ${projectId} не найден`,
            };
        }
        const resourceLoad = (0, resource_leveling_1.levelResources)({
            tasks: context.tasks,
            dependencies: context.dependencies,
            assignments: context.assignments,
            capacities: context.capacities,
            projectStart: context.project.start,
            projectEnd: context.project.end,
        });
        return {
            toolCallId,
            name: "get_resource_load",
            success: true,
            result: {
                projectId,
                conflicts: resourceLoad.conflicts,
                adjustments: resourceLoad.adjustments,
                criticalPath: resourceLoad.criticalPath,
            },
            displayMessage: resourceLoad.conflicts.length > 0
                ? `👷 Найдено ${resourceLoad.conflicts.length} конфликтов загрузки и ${resourceLoad.adjustments.length} рекомендаций по выравниванию`
                : "👷 Перегрузок ресурсов не найдено",
        };
    },
};
