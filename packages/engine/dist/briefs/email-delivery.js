var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { generatePortfolioBrief, generateProjectBrief } from './generate';
import { executeBriefDelivery, } from './delivery-ledger';
import { resolveBriefLocale } from './locale';
import { getEmailConnectorConfig, getEmailDefaultTo, sendEmailTextMessage, } from '../connectors/email-client';
export function deliverBriefByEmail(request_1) {
    return __awaiter(this, arguments, void 0, function* (request, deps = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const env = (_a = deps.env) !== null && _a !== void 0 ? _a : process.env;
        const locale = resolveBriefLocale(request.locale);
        const generatePortfolio = (_b = deps.generatePortfolio) !== null && _b !== void 0 ? _b : generatePortfolioBrief;
        const generateProject = (_c = deps.generateProject) !== null && _c !== void 0 ? _c : generateProjectBrief;
        const sendMessage = (_d = deps.sendMessage) !== null && _d !== void 0 ? _d : sendEmailTextMessage;
        if (request.scope === "project" && !request.projectId) {
            throw new Error("projectId is required for project brief delivery.");
        }
        const brief = request.scope === "portfolio"
            ? yield generatePortfolio({ locale })
            : yield generateProject(request.projectId, { locale });
        const recipient = ((_e = request.recipient) === null || _e === void 0 ? void 0 : _e.trim()) || getEmailDefaultTo(env);
        const projectName = "project" in brief ? brief.project.name : null;
        if (!request.dryRun && !recipient) {
            throw new Error("Email recipient is required when no EMAIL_DEFAULT_TO is configured.");
        }
        const config = request.dryRun ? null : getEmailConnectorConfig(env);
        if (!request.dryRun && !config) {
            throw new Error("SMTP is not configured.");
        }
        const execution = yield executeBriefDelivery({
            channel: "email",
            provider: "smtp",
            mode: "manual",
            scope: request.scope,
            projectId: request.projectId,
            projectName,
            locale,
            target: recipient !== null && recipient !== void 0 ? recipient : null,
            headline: brief.headline,
            content: {
                subject: brief.formats.emailDigest.subject,
                previewText: brief.formats.emailDigest.preview,
                bodyText: brief.formats.emailDigest.body,
            },
            requestPayload: {
                scope: request.scope,
                projectId: (_f = request.projectId) !== null && _f !== void 0 ? _f : null,
                locale,
                recipient: recipient !== null && recipient !== void 0 ? recipient : null,
                dryRun: (_g = request.dryRun) !== null && _g !== void 0 ? _g : false,
            },
            dryRun: request.dryRun,
            idempotencyKey: request.idempotencyKey,
            env,
            execute: () => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const sendResult = yield sendMessage({
                    config: config,
                    to: recipient,
                    subject: brief.formats.emailDigest.subject,
                    text: brief.formats.emailDigest.body,
                });
                if (!sendResult.ok) {
                    throw new Error(sendResult.message);
                }
                return {
                    providerMessageId: sendResult.messageId,
                    providerPayload: {
                        messageId: (_a = sendResult.messageId) !== null && _a !== void 0 ? _a : null,
                    },
                };
            }),
        });
        return Object.assign(Object.assign({ scope: request.scope, locale,
            recipient, headline: brief.headline, delivered: !request.dryRun, dryRun: (_h = request.dryRun) !== null && _h !== void 0 ? _h : false, subject: brief.formats.emailDigest.subject, previewText: brief.formats.emailDigest.preview, bodyText: brief.formats.emailDigest.body }, (execution.providerMessageId ? { messageId: execution.providerMessageId } : {})), { replayed: execution.replayed, ledger: execution.ledger });
    });
}
