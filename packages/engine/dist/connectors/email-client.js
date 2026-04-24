var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import nodemailer from "nodemailer";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SECURE_SMTP_PORT = 465;
let transportFactory = createNodeMailerTransport;
function createNodeMailerTransport(config) {
    return nodemailer.createTransport({
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
    if (!(rawValue === null || rawValue === void 0 ? void 0 : rawValue.trim())) {
        return null;
    }
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
function parseSecureFlag(rawValue) {
    if (!(rawValue === null || rawValue === void 0 ? void 0 : rawValue.trim())) {
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
function closeTransport(transport) {
    return __awaiter(this, void 0, void 0, function* () {
        if (typeof transport.close === "function") {
            yield transport.close();
        }
    });
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
export function setEmailTransportFactoryForTests(factory) {
    transportFactory = factory !== null && factory !== void 0 ? factory : createNodeMailerTransport;
}
export function getEmailFrom(env = process.env) {
    var _a;
    return ((_a = env.EMAIL_FROM) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getEmailDefaultTo(env = process.env) {
    var _a;
    return ((_a = env.EMAIL_DEFAULT_TO) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getSmtpHost(env = process.env) {
    var _a;
    return ((_a = env.SMTP_HOST) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getSmtpUser(env = process.env) {
    var _a;
    return ((_a = env.SMTP_USER) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getSmtpPassword(env = process.env) {
    var _a;
    return ((_a = env.SMTP_PASSWORD) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
export function getSmtpPort(env = process.env) {
    const explicitPort = parseExplicitPort(env.SMTP_PORT);
    if (explicitPort !== null) {
        return explicitPort;
    }
    return getSmtpSecure(env) ? DEFAULT_SECURE_SMTP_PORT : DEFAULT_SMTP_PORT;
}
export function getSmtpSecure(env = process.env) {
    const explicitSecure = parseSecureFlag(env.SMTP_SECURE);
    if (explicitSecure !== null) {
        return explicitSecure;
    }
    return parseExplicitPort(env.SMTP_PORT) === DEFAULT_SECURE_SMTP_PORT;
}
export function getEmailConnectorMissingSecrets(env = process.env) {
    return [
        ...(getEmailFrom(env) ? [] : ["EMAIL_FROM"]),
        ...(getSmtpHost(env) ? [] : ["SMTP_HOST"]),
        ...(getSmtpUser(env) ? [] : ["SMTP_USER"]),
        ...(getSmtpPassword(env) ? [] : ["SMTP_PASSWORD"]),
    ];
}
export function getEmailConnectorConfig(env = process.env) {
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
export function probeEmailTransport(config_1) {
    return __awaiter(this, arguments, void 0, function* (config, factory = transportFactory) {
        const transport = factory(config);
        try {
            yield transport.verify();
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
            yield closeTransport(transport);
        }
    });
}
export function sendEmailTextMessage(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, factory = transportFactory) {
        const transport = factory(input.config);
        try {
            const result = yield transport.sendMail({
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
            yield closeTransport(transport);
        }
    });
}
