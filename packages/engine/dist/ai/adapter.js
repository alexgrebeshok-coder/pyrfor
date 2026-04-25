import { createGatewayAIAdapter } from './gateway-adapter.js';
import { createMockAIAdapter } from './mock-adapter.js';
export function createAIAdapter(mode) {
    switch (mode) {
        case "gateway":
            return createGatewayAIAdapter();
        case "mock":
        default:
            return createMockAIAdapter();
    }
}
