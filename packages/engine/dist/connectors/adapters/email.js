var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getEmailConnectorConfig, getEmailConnectorMissingSecrets, probeEmailTransport, } from '../email-client';
const descriptor = {
    id: "email",
    name: "Email",
    description: "Outbound email channel for executive digests, approvals, and escalation notices. It now performs a live SMTP readiness probe and sends brief digests through the same transport.",
    direction: "outbound",
    sourceSystem: "SMTP-compatible provider",
    operations: [
        "Verify live SMTP readiness via transport probe",
        "Send executive brief digests over SMTP",
        "Send approval and escalation notifications",
    ],
    credentials: [
        {
            envVar: "EMAIL_FROM",
            description: "Default sender identity for outbound messages.",
        },
        {
            envVar: "EMAIL_DEFAULT_TO",
            description: "Optional default recipient used when operator input is omitted.",
            required: false,
        },
        {
            envVar: "SMTP_HOST",
            description: "SMTP server hostname.",
        },
        {
            envVar: "SMTP_PORT",
            description: "Optional SMTP port override. Defaults to 587 or 465 for secure mode.",
            required: false,
        },
        {
            envVar: "SMTP_SECURE",
            description: "Optional secure transport flag. Accepts true/false style values.",
            required: false,
        },
        {
            envVar: "SMTP_USER",
            description: "SMTP username or service account.",
        },
        {
            envVar: "SMTP_PASSWORD",
            description: "SMTP password or app-specific secret.",
        },
    ],
    apiSurface: [
        {
            method: "GET",
            path: "/api/connectors/email",
            description: "Connector status for the email channel.",
        },
        {
            method: "POST",
            path: "/api/connectors/email/briefs",
            description: "Preview or send an executive brief digest through the live email channel.",
        },
    ],
    stub: false,
};
export function createEmailConnector(env = process.env, transportFactory) {
    return Object.assign(Object.assign({}, descriptor), { getStatus() {
            return __awaiter(this, void 0, void 0, function* () {
                const checkedAt = new Date().toISOString();
                const missingSecrets = getEmailConnectorMissingSecrets(env);
                if (missingSecrets.length > 0) {
                    return Object.assign(Object.assign({}, descriptor), { status: "pending", configured: false, checkedAt,
                        missingSecrets, message: "Email live probe is waiting for EMAIL_FROM, SMTP_HOST, SMTP_USER, and SMTP_PASSWORD." });
                }
                const config = getEmailConnectorConfig(env);
                if (!config) {
                    return Object.assign(Object.assign({}, descriptor), { status: "pending", configured: false, checkedAt,
                        missingSecrets, message: "Email live probe is waiting for SMTP configuration." });
                }
                try {
                    const probeResult = yield probeEmailTransport(config, transportFactory);
                    if (!probeResult.ok) {
                        return Object.assign(Object.assign({}, descriptor), { status: "degraded", configured: true, checkedAt, missingSecrets: [], message: `Email probe failed: ${probeResult.message}`, metadata: probeResult.metadata });
                    }
                    return Object.assign(Object.assign({}, descriptor), { status: probeResult.remoteStatus, configured: true, checkedAt, missingSecrets: [], message: probeResult.message, metadata: probeResult.metadata });
                }
                catch (error) {
                    return Object.assign(Object.assign({}, descriptor), { status: "degraded", configured: true, checkedAt, missingSecrets: [], message: error instanceof Error
                            ? `Email probe failed: ${error.message}`
                            : "Email probe failed with an unknown error." });
                }
            });
        } });
}
