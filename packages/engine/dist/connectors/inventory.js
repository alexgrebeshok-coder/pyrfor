function missingSecretsFor(connector, env) {
    const credentialSecrets = connector.credentials
        .filter((credential) => credential.required !== false)
        .map((credential) => credential.envVar)
        .filter((envVar) => { var _a; return !((_a = env[envVar]) === null || _a === void 0 ? void 0 : _a.trim()); });
    const probe = probeFor(connector);
    const probeSecrets = probe
        ? [probe.baseUrlEnvVar, probe.authEnvVar].filter((envVar) => { var _a; return Boolean((envVar === null || envVar === void 0 ? void 0 : envVar.trim()) && !((_a = env[envVar]) === null || _a === void 0 ? void 0 : _a.trim())); })
        : [];
    return unique([...credentialSecrets, ...probeSecrets]);
}
function hasProbe(connector) {
    return connector.probe !== undefined || connector.stub === false;
}
function probeFor(connector) {
    const probe = connector.probe;
    return probe && typeof probe === 'object' ? probe : undefined;
}
function unique(values) {
    return Array.from(new Set(values.filter((value) => Boolean(value === null || value === void 0 ? void 0 : value.trim()))));
}
function safeProbePath(path) {
    var _a;
    if (!(path === null || path === void 0 ? void 0 : path.trim()))
        return undefined;
    const trimmed = path.trim();
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return undefined;
        return parsed.pathname || '/';
    }
    catch (_b) {
        const pathOnly = (_a = trimmed.split(/[?#]/, 1)[0]) === null || _a === void 0 ? void 0 : _a.trim();
        if (!pathOnly)
            return undefined;
        if (pathOnly.startsWith('~') ||
            /^[A-Za-z]:[\\/]/.test(pathOnly) ||
            pathOnly.includes('\\') ||
            /^\/(Users|home|private|var|tmp|etc|opt|Volumes)\//.test(pathOnly)) {
            return undefined;
        }
        return pathOnly.slice(0, 160);
    }
}
function buildReadiness(connector, missingSecrets, connectorHasProbe) {
    if (missingSecrets.length > 0) {
        return {
            state: 'pending',
            reasons: [`Missing required env: ${missingSecrets.join(', ')}`],
            nextStep: `Set ${missingSecrets.join(', ')} and refresh Connector Doctor.`,
        };
    }
    if (connector.stub) {
        return {
            state: 'stub',
            reasons: ['Stub connector: no live implementation is installed.'],
            nextStep: 'Install or enable a non-stub connector implementation before live use.',
        };
    }
    return {
        state: 'configured',
        reasons: [
            'Required env names are present in local configuration.',
            connectorHasProbe
                ? 'Live health check requires explicit Trust approval.'
                : 'No live probe is declared for this connector.',
        ],
        nextStep: connectorHasProbe
            ? 'Request live probe approval to verify remote health.'
            : 'Use supported local workflows; no live health probe is available.',
    };
}
function buildProbePreview(connector, missingSecrets, connectorHasProbe) {
    var _a, _b, _c;
    if (!connectorHasProbe)
        return undefined;
    const probe = probeFor(connector);
    if (!probe) {
        return {
            mode: 'descriptor-status',
            requiresApproval: true,
            requiredEnvVars: [...missingSecrets],
            headerNames: [],
            bodyConfigured: false,
            note: 'Live status comes from the connector adapter and is not executed by inventory.',
        };
    }
    return {
        mode: 'manifest-probe',
        requiresApproval: true,
        method: (_a = probe.method) !== null && _a !== void 0 ? _a : 'GET',
        path: safeProbePath((_b = probe.path) !== null && _b !== void 0 ? _b : '/health'),
        baseUrlEnvVar: probe.baseUrlEnvVar,
        authEnvVar: probe.authEnvVar,
        authHeaderName: probe.authHeaderName,
        expectedStatus: probe.expectedStatus,
        expectation: probe.expectation,
        requiredEnvVars: unique([...missingSecrets, probe.baseUrlEnvVar, probe.authEnvVar]),
        headerNames: Object.keys((_c = probe.headers) !== null && _c !== void 0 ? _c : {}),
        bodyConfigured: probe.body !== undefined,
        note: 'Dry-run preview only: no network request is made until Trust approval is granted.',
    };
}
export function buildConnectorInventorySnapshot(registry, env = process.env, now = () => new Date()) {
    const connectors = registry.list().map((connector) => {
        const missingSecrets = missingSecretsFor(connector, env);
        const connectorHasProbe = hasProbe(connector);
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
            hasProbe: connectorHasProbe,
            readiness: buildReadiness(connector, missingSecrets, connectorHasProbe),
            probePreview: buildProbePreview(connector, missingSecrets, connectorHasProbe),
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
