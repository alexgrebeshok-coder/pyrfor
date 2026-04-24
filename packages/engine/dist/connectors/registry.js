var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createEmailConnector } from './adapters/email';
import { createGpsConnector } from './adapters/gps';
import { createOneCConnector } from './adapters/one-c';
import { createTelegramConnector } from './adapters/telegram';
import { createManifestConnector, loadConnectorManifestsFromEnv } from './manifests';
import { logger } from '../observability/logger';
export class ConnectorRegistry {
    constructor() {
        this.connectors = new Map();
    }
    register(connector) {
        if (this.connectors.has(connector.id)) {
            throw new Error(`Connector '${connector.id}' is already registered.`);
        }
        this.connectors.set(connector.id, connector);
        return this;
    }
    get(id) {
        return this.connectors.get(id);
    }
    list() {
        return Array.from(this.connectors.values());
    }
    getStatus(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const connector = this.get(id);
            if (!connector) {
                return null;
            }
            return connector.getStatus();
        });
    }
    getStatuses() {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.all(this.list().map((connector) => connector.getStatus()));
        });
    }
}
export function createConnectorRegistry(env = process.env) {
    const registry = new ConnectorRegistry()
        .register(createTelegramConnector(env))
        .register(createEmailConnector(env))
        .register(createGpsConnector(env))
        .register(createOneCConnector(env));
    for (const manifest of loadConnectorManifestsFromEnv(env)) {
        try {
            registry.register(createManifestConnector(manifest, env));
        }
        catch (error) {
            logger.warn("Skipping connector manifest", {
                connector: manifest.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return registry;
}
export function summarizeConnectorStatuses(statuses) {
    const summary = statuses.reduce((accumulator, connector) => {
        accumulator.total += 1;
        if (connector.configured) {
            accumulator.configured += 1;
        }
        if (connector.status === "ok") {
            accumulator.ok += 1;
        }
        else if (connector.status === "degraded") {
            accumulator.degraded += 1;
        }
        else {
            accumulator.pending += 1;
        }
        return accumulator;
    }, {
        total: 0,
        configured: 0,
        ok: 0,
        pending: 0,
        degraded: 0,
    });
    const status = summary.degraded > 0 ? "degraded" : summary.pending > 0 ? "pending" : "ok";
    return Object.assign({ status }, summary);
}
const defaultRegistry = createConnectorRegistry();
export function getConnectorRegistry() {
    return defaultRegistry;
}
