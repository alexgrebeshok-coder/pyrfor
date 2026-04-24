var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { calculateCriticalPath } from '../../scheduling/critical-path';
import { levelResources } from '../../scheduling/resource-leveling';
import { getProjectSchedulingContext } from '../../scheduling/service';
import { resolveActiveProjectId } from './shared';
export const schedulingToolService = {
    getCriticalPath(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const projectId = yield resolveActiveProjectId(args.projectId);
            if (!projectId) {
                return {
                    toolCallId,
                    name: "get_critical_path",
                    success: false,
                    result: { error: "No project found" },
                    displayMessage: "❌ Нет доступного проекта для расчёта критического пути",
                };
            }
            const context = yield getProjectSchedulingContext(projectId);
            if (!context) {
                return {
                    toolCallId,
                    name: "get_critical_path",
                    success: false,
                    result: { error: `Project ${projectId} not found` },
                    displayMessage: `❌ Проект ${projectId} не найден`,
                };
            }
            const criticalPath = calculateCriticalPath({
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
        });
    },
    getResourceLoad(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const projectId = yield resolveActiveProjectId(args.projectId);
            if (!projectId) {
                return {
                    toolCallId,
                    name: "get_resource_load",
                    success: false,
                    result: { error: "No project found" },
                    displayMessage: "❌ Нет доступного проекта для расчёта загрузки ресурсов",
                };
            }
            const context = yield getProjectSchedulingContext(projectId);
            if (!context) {
                return {
                    toolCallId,
                    name: "get_resource_load",
                    success: false,
                    result: { error: `Project ${projectId} not found` },
                    displayMessage: `❌ Проект ${projectId} не найден`,
                };
            }
            const resourceLoad = levelResources({
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
        });
    },
};
