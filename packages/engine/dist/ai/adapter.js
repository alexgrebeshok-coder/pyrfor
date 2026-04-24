import { createGatewayAIAdapter } from './gateway-adapter';
import { createMockAIAdapter } from './mock-adapter';
export function createAIAdapter(mode) {
    switch (mode) {
        case "gateway":
            return createGatewayAIAdapter();
        case "mock":
        default:
            return createMockAIAdapter();
    }
}
