import { createGatewayAIAdapter } from './gateway-adapter';
import { createMockAIAdapter } from './mock-adapter';
import type { AIAdapter, AIAdapterMode } from './types';

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
