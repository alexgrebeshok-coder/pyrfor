"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setEmailTransportFactoryForTests = setEmailTransportFactoryForTests;
exports.getEmailFrom = getEmailFrom;
exports.getEmailDefaultTo = getEmailDefaultTo;
exports.getSmtpHost = getSmtpHost;
exports.getSmtpUser = getSmtpUser;
exports.getSmtpPassword = getSmtpPassword;
exports.getSmtpPort = getSmtpPort;
exports.getSmtpSecure = getSmtpSecure;
exports.getEmailConnectorMissingSecrets = getEmailConnectorMissingSecrets;
exports.getEmailConnectorConfig = getEmailConnectorConfig;
exports.probeEmailTransport = probeEmailTransport;
exports.sendEmailTextMessage = sendEmailTextMessage;
const nodemailer_1 = __importDefault(require("nodemailer"));
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SECURE_SMTP_PORT = 465;
let transportFactory = createNodeMailerTransport;
function createNodeMailerTransport(config) {
    return nodemailer_1.default.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.password,
        },
    });
}
function parseExplicitPort(rawValue) {
    if (!rawValue?.trim()) {
        return null;
    }
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
function parseSecureFlag(rawValue) {
    if (!rawValue?.trim()) {
        return null;
    }
    const normalized = rawValue.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }
    return null;
}
async function closeTransport(transport) {
    if (typeof transport.close === "function") {
        await transport.close();
    }
}
function buildMetadata(config) {
    return {
        sender: config.from,
        defaultRecipient: config.defaultTo,
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.user,
    };
}
function setEmailTransportFactoryForTests(factory) {
    transportFactory = factory ?? createNodeMailerTransport;
}
function getEmailFrom(env = process.env) {
    return env.EMAIL_FROM?.trim() || null;
}
function getEmailDefaultTo(env = process.env) {
    return env.EMAIL_DEFAULT_TO?.trim() || null;
}
function getSmtpHost(env = process.env) {
    return env.SMTP_HOST?.trim() || null;
}
function getSmtpUser(env = process.env) {
    return env.SMTP_USER?.trim() || null;
}
function getSmtpPassword(env = process.env) {
    return env.SMTP_PASSWORD?.trim() || null;
}
function getSmtpPort(env = process.env) {
    const explicitPort = parseExplicitPort(env.SMTP_PORT);
    if (explicitPort !== null) {
        return explicitPort;
    }
    return getSmtpSecure(env) ? DEFAULT_SECURE_SMTP_PORT : DEFAULT_SMTP_PORT;
}
function getSmtpSecure(env = process.env) {
    const explicitSecure = parseSecureFlag(env.SMTP_SECURE);
    if (explicitSecure !== null) {
        return explicitSecure;
    }
    return parseExplicitPort(env.SMTP_PORT) === DEFAULT_SECURE_SMTP_PORT;
}
function getEmailConnectorMissingSecrets(env = process.env) {
    return [
        ...(getEmailFrom(env) ? [] : ["EMAIL_FROM"]),
        ...(getSmtpHost(env) ? [] : ["SMTP_HOST"]),
        ...(getSmtpUser(env) ? [] : ["SMTP_USER"]),
        ...(getSmtpPassword(env) ? [] : ["SMTP_PASSWORD"]),
    ];
}
function getEmailConnectorConfig(env = process.env) {
    const missingSecrets = getEmailConnectorMissingSecrets(env);
    if (missingSecrets.length > 0) {
        return null;
    }
    return {
        from: getEmailFrom(env),
        defaultTo: getEmailDefaultTo(env),
        host: getSmtpHost(env),
        port: getSmtpPort(env),
        secure: getSmtpSecure(env),
        user: getSmtpUser(env),
        password: getSmtpPassword(env),
    };
}
async function probeEmailTransport(config, factory = transportFactory) {
    const transport = factory(config);
    try {
        await transport.verify();
        return {
            ok: true,
            remoteStatus: "ok",
            message: `SMTP transport verified for ${config.from} via ${config.host}:${config.port}.`,
            metadata: buildMetadata(config),
        };
    }
    catch (error) {
        return {
            ok: false,
            message: error instanceof Error
                ? `SMTP verify failed: ${error.message}`
                : "SMTP verify failed with an unknown error.",
            metadata: buildMetadata(config),
        };
    }
    finally {
        await closeTransport(transport);
    }
}
async function sendEmailTextMessage(input, factory = transportFactory) {
    const transport = factory(input.config);
    try {
        const result = await transport.sendMail({
            from: input.config.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
        });
        return {
            ok: true,
            messageId: result.messageId,
        };
    }
    catch (error) {
        return {
            ok: false,
            message: error instanceof Error
                ? `SMTP delivery failed: ${error.message}`
                : "SMTP delivery failed with an unknown error.",
        };
    }
    finally {
        await closeTransport(transport);
    }
}
