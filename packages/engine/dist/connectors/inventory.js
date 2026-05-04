function missingSecretsFor(connector, env) {
    return connector.credentials
        .filter((credential) => credential.required !== false)
        .map((credential) => credential.envVar)
        .filter((envVar) => { var _a; return !((_a = env[envVar]) === null || _a === void 0 ? void 0 : _a.trim()); });
}
function hasProbe(connector) {
    return connector.probe !== undefined || connector.stub === false;
}
export function buildConnectorInventorySnapshot(registry, env = process.env, now = () => new Date()) {
    const connectors = registry.list().map((connector) => {
        const missingSecrets = missingSecretsFor(connector, env);
        return {
            id: connector.id,
            name: connector.name,
            description: connector.description,
            direction: connector.direction,
            sourceSystem: connector.sourceSystem,
            operations: [...connector.operations],
            credentials: connector.credentials.map((credential) => (Object.assign({}, credential))),
            apiSurface: connector.apiSurface.map((surface) => (Object.assign({}, surface))),
            stub: connector.stub,
            configured: missingSecrets.length === 0,
            missingSecrets,
            hasProbe: hasProbe(connector),
            liveProbeSkipped: true,
            statusSource: 'local-config',
        };
    }).sort((left, right) => left.id.localeCompare(right.id));
    return {
        checkedAt: now().toISOString(),
        statusSource: 'local-config',
        connectors,
        summary: {
            total: connectors.length,
            configured: connectors.filter((connector) => connector.configured).length,
            pending: connectors.filter((connector) => !connector.configured).length,
            stubs: connectors.filter((connector) => connector.stub).length,
            liveProbeSkipped: connectors.length,
        },
    };
}
