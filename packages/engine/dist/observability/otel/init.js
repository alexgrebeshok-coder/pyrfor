var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
let activeProvider = null;
/** Start OTLP export; returns shutdown hook (no-op when disabled). */
export function initOtel(config) {
    var _a, _b;
    if (!config.enabled) {
        return () => __awaiter(this, void 0, void 0, function* () { });
    }
    void shutdownOtel();
    const endpoint = (_a = config.endpoint) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:4318/v1/traces';
    const provider = new NodeTracerProvider({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: (_b = config.serviceName) !== null && _b !== void 0 ? _b : 'pyrfor-engine',
        }),
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint })));
    provider.register();
    activeProvider = provider;
    return () => __awaiter(this, void 0, void 0, function* () {
        yield shutdownOtel();
    });
}
export function shutdownOtel() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!activeProvider)
            return;
        const provider = activeProvider;
        activeProvider = null;
        yield provider.shutdown().catch(() => { });
    });
}
