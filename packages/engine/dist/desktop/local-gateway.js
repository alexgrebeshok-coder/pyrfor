"use client";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktop } from '../utils/index.js';
export function getDesktopLocalGatewayStatus() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isTauriDesktop()) {
            return null;
        }
        try {
            return yield invoke("local_gateway_status");
        }
        catch (_a) {
            return null;
        }
    });
}
export function runDesktopLocalGatewayPrompt(input) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isTauriDesktop()) {
            throw new Error("Desktop local gateway bridge is only available in Tauri.");
        }
        return yield invoke("local_gateway_chat", {
            prompt: input.prompt,
            runId: input.runId,
            sessionKey: input.sessionKey,
            model: input.model,
        });
    });
}
