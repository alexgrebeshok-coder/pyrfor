"use client";

import { invoke } from "@tauri-apps/api/core";

import { isTauriDesktop } from '../utils';

export interface DesktopLocalGatewayStatus {
  mode?: "gateway" | "provider" | "mock" | "unavailable";
  gatewayKind?: "local" | "remote" | "missing";
  available: boolean;
  running: boolean;
  port: number | null;
  gateway_url: string | null;
  probe_url: string | null;
  config_path: string | null;
  chat_completions_enabled: boolean;
  token_configured: boolean;
  message: string;
  model_path?: string;
  adapter_path?: string | null;
  python_path?: string | null;
  auto_start?: boolean;
  unavailableReason?: string | null;
}

export interface DesktopLocalGatewayChatResponse {
  content: string;
  gateway_url: string;
  port: number;
  model: string;
}

export async function getDesktopLocalGatewayStatus(): Promise<DesktopLocalGatewayStatus | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  try {
    return await invoke<DesktopLocalGatewayStatus>("local_gateway_status");
  } catch {
    return null;
  }
}

export async function runDesktopLocalGatewayPrompt(input: {
  prompt: string;
  runId: string;
  sessionKey?: string;
  model?: string;
}): Promise<DesktopLocalGatewayChatResponse> {
  if (!isTauriDesktop()) {
    throw new Error("Desktop local gateway bridge is only available in Tauri.");
  }

  return await invoke<DesktopLocalGatewayChatResponse>("local_gateway_chat", {
    prompt: input.prompt,
    runId: input.runId,
    sessionKey: input.sessionKey,
    model: input.model,
  });
}
