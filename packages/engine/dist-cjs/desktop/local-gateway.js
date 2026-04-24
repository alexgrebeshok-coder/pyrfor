"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDesktopLocalGatewayStatus = getDesktopLocalGatewayStatus;
exports.runDesktopLocalGatewayPrompt = runDesktopLocalGatewayPrompt;
const core_1 = require("@tauri-apps/api/core");
const utils_1 = require("../utils");
async function getDesktopLocalGatewayStatus() {
    if (!(0, utils_1.isTauriDesktop)()) {
        return null;
    }
    try {
        return await (0, core_1.invoke)("local_gateway_status");
    }
    catch {
        return null;
    }
}
async function runDesktopLocalGatewayPrompt(input) {
    if (!(0, utils_1.isTauriDesktop)()) {
        throw new Error("Desktop local gateway bridge is only available in Tauri.");
    }
    return await (0, core_1.invoke)("local_gateway_chat", {
        prompt: input.prompt,
        runId: input.runId,
        sessionKey: input.sessionKey,
        model: input.model,
    });
}
