"use strict";
/**
 * AI Tool Executor — thin dispatcher over canonical tool domain services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeToolCall = executeToolCall;
exports.executeToolCalls = executeToolCalls;
const finance_service_1 = require("./tool-services/finance-service");
const inventory_service_1 = require("./tool-services/inventory-service");
const plugin_system_1 = require("./plugin-system");
const project_service_1 = require("./tool-services/project-service");
const scheduling_service_1 = require("./tool-services/scheduling-service");
const TOOL_HANDLERS = {
    create_task: project_service_1.projectToolService.createTask,
    create_risk: project_service_1.projectToolService.createRisk,
    update_task: project_service_1.projectToolService.updateTask,
    get_project_summary: project_service_1.projectToolService.getProjectSummary,
    list_tasks: project_service_1.projectToolService.listTasks,
    generate_brief: project_service_1.projectToolService.generateBrief,
    create_expense: finance_service_1.financeToolService.createExpense,
    get_budget_summary: finance_service_1.financeToolService.getBudgetSummary,
    list_equipment: inventory_service_1.inventoryToolService.listEquipment,
    create_material_movement: inventory_service_1.inventoryToolService.createMaterialMovement,
    get_critical_path: scheduling_service_1.schedulingToolService.getCriticalPath,
    get_resource_load: scheduling_service_1.schedulingToolService.getResourceLoad,
    sync_1c: (toolCallId) => finance_service_1.financeToolService.syncOneC(toolCallId),
};
async function executeToolCall(call) {
    (0, plugin_system_1.ensureBuiltinPluginsRegistered)();
    const name = call.function.name;
    const handler = TOOL_HANDLERS[name];
    let args;
    try {
        args = JSON.parse(call.function.arguments);
    }
    catch {
        return {
            toolCallId: call.id,
            name,
            success: false,
            result: { error: "Invalid JSON arguments" },
            displayMessage: "❌ Ошибка: некорректные аргументы",
        };
    }
    if (!handler) {
        const plugin = (0, plugin_system_1.getPlugin)(call.function.name);
        if (plugin) {
            const pluginResult = await (0, plugin_system_1.executePlugin)(call.function.name, args);
            return {
                toolCallId: call.id,
                name,
                success: pluginResult.success,
                result: pluginResult.success
                    ? (pluginResult.data ?? {})
                    : { error: pluginResult.error ?? "Plugin execution failed" },
                displayMessage: pluginResult.success
                    ? `✅ Plugin ${call.function.name} executed`
                    : `❌ Plugin ${call.function.name}: ${pluginResult.error ?? "execution failed"}`,
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
        return await handler(call.id, args);
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
}
async function executeToolCalls(calls) {
    return Promise.all(calls.map(executeToolCall));
}
