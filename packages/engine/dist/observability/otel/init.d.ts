export interface OtelConfig {
    enabled: boolean;
    endpoint?: string;
    serviceName?: string;
}
/** Start OTLP export; returns shutdown hook (no-op when disabled). */
export declare function initOtel(config: OtelConfig): () => Promise<void>;
export declare function shutdownOtel(): Promise<void>;
//# sourceMappingURL=init.d.ts.map