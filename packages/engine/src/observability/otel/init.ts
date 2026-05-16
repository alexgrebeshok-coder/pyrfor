import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface OtelConfig {
  enabled: boolean;
  endpoint?: string;
  serviceName?: string;
}

let activeProvider: NodeTracerProvider | null = null;

/** Start OTLP export; returns shutdown hook (no-op when disabled). */
export function initOtel(config: OtelConfig): () => Promise<void> {
  if (!config.enabled) {
    return async () => {};
  }

  void shutdownOtel();

  const endpoint = config.endpoint ?? 'http://127.0.0.1:4318/v1/traces';
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName ?? 'pyrfor-engine',
    }),
  });
  provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint })));
  provider.register();
  activeProvider = provider;

  return async () => {
    await shutdownOtel();
  };
}

export async function shutdownOtel(): Promise<void> {
  if (!activeProvider) return;
  const provider = activeProvider;
  activeProvider = null;
  await provider.shutdown().catch(() => {});
}
