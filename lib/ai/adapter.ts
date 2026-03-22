import { createGatewayAIAdapter } from "@/lib/ai/gateway-adapter";
import { createMockAIAdapter } from "@/lib/ai/mock-adapter";
import { createProviderAdapter } from "@/lib/ai/provider-adapter";
import type { AIAdapter, AIAdapterMode } from "@/lib/ai/types";

export function createAIAdapter(mode: AIAdapterMode): AIAdapter {
  switch (mode) {
    case "provider":
      return createProviderAdapter();
    case "gateway":
      return createGatewayAIAdapter();
    case "mock":
    default:
      return createMockAIAdapter();
  }
}
