/**
 * AI Tool Executor — thin dispatcher over canonical tool domain services
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
import { financeToolService } from './tool-services/finance-service.js';
import { inventoryToolService } from './tool-services/inventory-service.js';
import { ensureBuiltinPluginsRegistered, getPlugin, executePlugin } from './plugin-system.js';
import { projectToolService } from './tool-services/project-service.js';
import { schedulingToolService } from './tool-services/scheduling-service.js';
const TOOL_HANDLERS = {
    create_task: projectToolService.createTask,
    create_risk: projectToolService.createRisk,
    update_task: projectToolService.updateTask,
    get_project_summary: projectToolService.getProjectSummary,
    list_tasks: projectToolService.listTasks,
    generate_brief: projectToolService.generateBrief,
    create_expense: financeToolService.createExpense,
    get_budget_summary: financeToolService.getBudgetSummary,
    list_equipment: inventoryToolService.listEquipment,
    create_material_movement: inventoryToolService.createMaterialMovement,
    get_critical_path: schedulingToolService.getCriticalPath,
    get_resource_load: schedulingToolService.getResourceLoad,
    sync_1c: (toolCallId) => financeToolService.syncOneC(toolCallId),
};
export function executeToolCall(call) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        ensureBuiltinPluginsRegistered();
        const name = call.function.name;
        const handler = TOOL_HANDLERS[name];
        let args;
        try {
            args = JSON.parse(call.function.arguments);
        }
        catch (_d) {
            return {
                toolCallId: call.id,
                name,
                success: false,
                result: { error: "Invalid JSON arguments" },
                displayMessage: "❌ Ошибка: некорректные аргументы",
            };
        }
        if (!handler) {
            const plugin = getPlugin(call.function.name);
            if (plugin) {
                const pluginResult = yield executePlugin(call.function.name, args);
                return {
                    toolCallId: call.id,
                    name,
                    success: pluginResult.success,
                    result: pluginResult.success
                        ? ((_a = pluginResult.data) !== null && _a !== void 0 ? _a : {})
                        : { error: (_b = pluginResult.error) !== null && _b !== void 0 ? _b : "Plugin execution failed" },
                    displayMessage: pluginResult.success
                        ? `✅ Plugin ${call.function.name} executed`
                        : `❌ Plugin ${call.function.name}: ${(_c = pluginResult.error) !== null && _c !== void 0 ? _c : "execution failed"}`,
                };
            }
            return {
                toolCallId: call.id,
                name,
                success: false,
                result: { error: `Unknown tool: ${name}` },
                displayMessage: `❌ Неизвестный инструмент: ${name}`,
            };
        }
        try {
            return yield handler(call.id, args);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                toolCallId: call.id,
                name,
                success: false,
                result: { error: message },
                displayMessage: `❌ Ошибка: ${message}`,
            };
        }
    });
}
export function executeToolCalls(calls) {
    return __awaiter(this, void 0, void 0, function* () {
        return Promise.all(calls.map(executeToolCall));
    });
}
