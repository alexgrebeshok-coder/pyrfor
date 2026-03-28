import { createGatewayAIAdapter } from "@/lib/ai/gateway-adapter";
import { createMockAIAdapter } from "@/lib/ai/mock-adapter";
import type { AIAdapter, AIAdapterMode } from "@/lib/ai/types";

export type ClientAIAdapterMode = Exclude<AIAdapterMode, "provider">;

export function createAIAdapter(mode: ClientAIAdapterMode): AIAdapter {
  switch (mode) {
    case "gateway":
      return createGatewayAIAdapter();
    case "mock":
    default:
      return createMockAIAdapter();
  }
}
