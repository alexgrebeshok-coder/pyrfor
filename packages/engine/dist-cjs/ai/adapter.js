"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAIAdapter = createAIAdapter;
const gateway_adapter_1 = require("./gateway-adapter");
const mock_adapter_1 = require("./mock-adapter");
function createAIAdapter(mode) {
    switch (mode) {
        case "gateway":
            return (0, gateway_adapter_1.createGatewayAIAdapter)();
        case "mock":
        default:
            return (0, mock_adapter_1.createMockAIAdapter)();
    }
}
