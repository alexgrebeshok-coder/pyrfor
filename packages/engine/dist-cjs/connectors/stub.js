"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStubConnector = createStubConnector;
function getMissingSecrets(credentials, env) {
    return credentials
        .filter((credential) => credential.required !== false)
        .map((credential) => credential.envVar)
        .filter((envVar) => !env[envVar]?.trim());
}
function buildStatusMessage(descriptor, configured, missingSecrets) {
    if (configured) {
        return `${descriptor.name} stub is configured and ready for deeper implementation.`;
    }
    return `${descriptor.name} stub is waiting for credentials: ${missingSecrets.join(", ")}.`;
}
function createStubConnector(descriptor, env = process.env) {
    return {
        ...descriptor,
        async getStatus() {
            const missingSecrets = getMissingSecrets(descriptor.credentials, env);
            const configured = missingSecrets.length === 0;
            return {
                ...descriptor,
                configured,
                checkedAt: new Date().toISOString(),
                message: buildStatusMessage(descriptor, configured, missingSecrets),
                missingSecrets,
                status: configured ? "ok" : "pending",
            };
        },
    };
}
