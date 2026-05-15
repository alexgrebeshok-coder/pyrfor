var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/**
 * Minimal lifecycle coordinator for MCP servers (engine-side stub).
 * Stdio sidecar restart is deferred to the IDE host.
 */
export class McpLifecycleManagerStub {
    constructor(client, configs = new Map()) {
        this.client = client;
        this.configs = configs;
    }
    registerConfig(config) {
        this.configs.set(config.name, config);
    }
    healthCheck(serverName) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.client.isConnected(serverName);
        });
    }
    restart(serverName) {
        return __awaiter(this, void 0, void 0, function* () {
            const config = this.configs.get(serverName);
            if (!config) {
                throw new Error(`[MCP] no config registered for server '${serverName}'`);
            }
            yield this.client.disconnect(serverName);
            yield this.client.connect(config);
        });
    }
    shutdown() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.client.shutdown();
        });
    }
    getRegisteredServerNames() {
        return [...this.configs.keys()];
    }
}
