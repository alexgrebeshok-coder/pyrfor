"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorRegistry = void 0;
exports.createConnectorRegistry = createConnectorRegistry;
exports.summarizeConnectorStatuses = summarizeConnectorStatuses;
exports.getConnectorRegistry = getConnectorRegistry;
const email_1 = require("./adapters/email");
const gps_1 = require("./adapters/gps");
const one_c_1 = require("./adapters/one-c");
const telegram_1 = require("./adapters/telegram");
const manifests_1 = require("./manifests");
const logger_1 = require("../observability/logger");
class ConnectorRegistry {
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
    async getStatus(id) {
        const connector = this.get(id);
        if (!connector) {
            return null;
        }
        return connector.getStatus();
    }
    async getStatuses() {
        return Promise.all(this.list().map((connector) => connector.getStatus()));
    }
}
exports.ConnectorRegistry = ConnectorRegistry;
function createConnectorRegistry(env = process.env) {
    const registry = new ConnectorRegistry()
        .register((0, telegram_1.createTelegramConnector)(env))
        .register((0, email_1.createEmailConnector)(env))
        .register((0, gps_1.createGpsConnector)(env))
        .register((0, one_c_1.createOneCConnector)(env));
    for (const manifest of (0, manifests_1.loadConnectorManifestsFromEnv)(env)) {
        try {
            registry.register((0, manifests_1.createManifestConnector)(manifest, env));
        }
        catch (error) {
            logger_1.logger.warn("Skipping connector manifest", {
                connector: manifest.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return registry;
}
function summarizeConnectorStatuses(statuses) {
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
    return {
        status,
        ...summary,
    };
}
const defaultRegistry = createConnectorRegistry();
function getConnectorRegistry() {
    return defaultRegistry;
}
