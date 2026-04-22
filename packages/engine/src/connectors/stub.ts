import type {
  ConnectorAdapter,
  ConnectorCredentialRequirement,
  ConnectorDescriptor,
  ConnectorStatus,
} from './types';

type RuntimeEnv = NodeJS.ProcessEnv;

function getMissingSecrets(
  credentials: ConnectorCredentialRequirement[],
  env: RuntimeEnv
): string[] {
  return credentials
    .filter((credential) => credential.required !== false)
    .map((credential) => credential.envVar)
    .filter((envVar) => !env[envVar]?.trim());
}

function buildStatusMessage(
  descriptor: ConnectorDescriptor,
  configured: boolean,
  missingSecrets: string[]
): string {
  if (configured) {
    return `${descriptor.name} stub is configured and ready for deeper implementation.`;
  }

  return `${descriptor.name} stub is waiting for credentials: ${missingSecrets.join(", ")}.`;
}

export function createStubConnector(
  descriptor: ConnectorDescriptor,
  env: RuntimeEnv = process.env
): ConnectorAdapter {
  return {
    ...descriptor,
    async getStatus(): Promise<ConnectorStatus> {
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
