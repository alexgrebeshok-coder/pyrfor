var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma.js';
import { executeBriefDelivery } from '../briefs/delivery-ledger.js';
import { generatePortfolioBrief } from '../briefs/generate.js';
import { resolveBriefLocale } from '../briefs/locale.js';
import { deliverBriefToTelegram } from '../briefs/telegram-delivery.js';
import { getEmailConnectorConfig, sendEmailTextMessage, } from '../connectors/email-client.js';
import { siteUrl } from '../config/site-url.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const WELCOME_SEQUENCE = [
    {
        id: "day0",
        dayOffset: 0,
        content: ({ name, locale }) => {
            const intro = locale === "ru" ? "Добро пожаловать" : "Welcome";
            const subject = locale === "ru"
                ? "Добро пожаловать в CEOClaw — начнём с первого шага"
                : "Welcome to CEOClaw — let’s make the first step useful";
            const previewText = locale === "ru"
                ? "Покажем, где начать и как быстро получить пользу от первого проекта."
                : "A quick path to your first useful project and weekly brief.";
            const bodyText = locale === "ru"
                ? [
                    `${intro}, ${name}.`,
                    "",
                    "CEOClaw помогает удерживать портфель, задачи и финансовый контур в одном месте.",
                    "Начните с первого проекта — после этого вы сразу увидите сводки, риски и AI-подсказки.",
                    "",
                    `Открыть onboarding: ${new URL("/onboarding", siteUrl).toString()}`,
                ].join("\n")
                : [
                    `${intro}, ${name}.`,
                    "",
                    "CEOClaw keeps your projects, tasks, and financial signal in one place.",
                    "Start with your first project so you can immediately see briefs, risks, and AI guidance.",
                    "",
                    `Open onboarding: ${new URL("/onboarding", siteUrl).toString()}`,
                ].join("\n");
            return {
                subject,
                previewText,
                bodyText,
                headline: subject,
            };
        },
    },
    {
        id: "day1",
        dayOffset: 1,
        content: ({ name, locale }) => {
            const subject = locale === "ru"
                ? "Ваш первый проект в CEOClaw"
                : "Your first project in CEOClaw";
            const previewText = locale === "ru"
                ? "Шаблон проекта и план первых действий уже готовы."
                : "Your project template and next steps are ready.";
            const bodyText = locale === "ru"
                ? [
                    `Привет, ${name}.`,
                    "",
                    "Самый быстрый путь к ценности — добавить один реальный проект и 2-3 стартовые задачи.",
                    "После этого AI начнёт работать с фактами, а не с пустым экраном.",
                    "",
                    `Открыть проекты: ${new URL("/projects", siteUrl).toString()}`,
                ].join("\n")
                : [
                    `Hi, ${name}.`,
                    "",
                    "The fastest path to value is adding one real project and 2-3 starter tasks.",
                    "After that, AI starts working with facts instead of empty screens.",
                    "",
                    `Open projects: ${new URL("/projects", siteUrl).toString()}`,
                ].join("\n");
            return {
                subject,
                previewText,
                bodyText,
                headline: subject,
            };
        },
    },
    {
        id: "day3",
        dayOffset: 3,
        content: ({ name, locale }) => {
            const subject = locale === "ru"
                ? "Проверьте AI briefs и финансовый контур"
                : "Check AI briefs and the financial view";
            const previewText = locale === "ru"
                ? "Короткий способ увидеть план-факт, сигналы и следующий шаг."
                : "A quick way to see plan-vs-fact, signals, and next steps.";
            const bodyText = locale === "ru"
                ? [
                    `Привет, ${name}.`,
                    "",
                    "Если проект уже запущен, посмотрите сводки и отклонения в briefs — там проще всего увидеть пользу AI.",
                    "",
                    `Открыть briefs: ${new URL("/briefs", siteUrl).toString()}`,
                ].join("\n")
                : [
                    `Hi, ${name}.`,
                    "",
                    "If your project is already moving, briefs are the quickest way to see plan-vs-fact and the next action.",
                    "",
                    `Open briefs: ${new URL("/briefs", siteUrl).toString()}`,
                ].join("\n");
            return {
                subject,
                previewText,
                bodyText,
                headline: subject,
            };
        },
    },
    {
        id: "day7",
        dayOffset: 7,
        content: ({ name, locale }) => {
            const subject = locale === "ru"
                ? "Подключите ежедневные briefs"
                : "Connect daily briefs";
            const previewText = locale === "ru"
                ? "Telegram и email-сводки помогают возвращать команду в ритм."
                : "Telegram and email briefs help keep the team in rhythm.";
            const bodyText = locale === "ru"
                ? [
                    `Привет, ${name}.`,
                    "",
                    "На этой неделе можно подключить ежедневные briefs, чтобы не терять контекст между созвонами.",
                    "",
                    `Настройки сводок: ${new URL("/briefs", siteUrl).toString()}`,
                ].join("\n")
                : [
                    `Hi, ${name}.`,
                    "",
                    "This week is a good time to connect daily briefs so context doesn't disappear between meetings.",
                    "",
                    `Brief settings: ${new URL("/briefs", siteUrl).toString()}`,
                ].join("\n");
            return {
                subject,
                previewText,
                bodyText,
                headline: subject,
            };
        },
    },
    {
        id: "day14",
        dayOffset: 14,
        content: ({ name, locale }) => {
            const subject = locale === "ru"
                ? "Две недели с CEOClaw — пора масштабировать"
                : "Two weeks with CEOClaw — time to scale";
            const previewText = locale === "ru"
                ? "Если продукт полезен, следующий шаг — поднять лимиты и открыть billing."
                : "If the product is useful, the next step is to raise limits and check billing.";
            const bodyText = locale === "ru"
                ? [
                    `Привет, ${name}.`,
                    "",
                    "Если вы уже используете продукт регулярно, посмотрите лимиты и планы — там проще понять, что нужно для масштабирования.",
                    "",
                    `Открыть billing: ${new URL("/billing", siteUrl).toString()}`,
                ].join("\n")
                : [
                    `Hi, ${name}.`,
                    "",
                    "If you're using CEOClaw regularly, check the plans and limits to see what you need to scale up.",
                    "",
                    `Open billing: ${new URL("/billing", siteUrl).toString()}`,
                ].join("\n");
            return {
                subject,
                previewText,
                bodyText,
                headline: subject,
            };
        },
    },
];
function dayKey(date) {
    return date.toISOString().slice(0, 10);
}
function weekKey(date) {
    const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const weekday = normalized.getUTCDay() || 7;
    normalized.setUTCDate(normalized.getUTCDate() - (weekday - 1));
    return normalized.toISOString().slice(0, 10);
}
function daysSince(start, now) {
    return Math.floor((now.getTime() - start.getTime()) / DAY_MS);
}
function normalizeLocale(value) {
    return resolveBriefLocale(value);
}
function getEmailConfig(env) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = getEmailConnectorConfig(env);
        if (!config) {
            throw new Error("SMTP is not configured.");
        }
        return config;
    });
}
function buildWelcomeEmailContent(phase, userName, locale) {
    return phase.content({
        name: userName,
        locale,
    });
}
function sendWelcomeEmailForPhase(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const emailConfig = yield getEmailConfig(env);
        const content = buildWelcomeEmailContent(input.phase, input.userName, input.locale);
        return executeBriefDelivery({
            channel: "email",
            provider: "smtp",
            mode: "scheduled",
            scope: "governance",
            locale: input.locale,
            target: input.recipient,
            headline: content.headline,
            content: {
                subject: content.subject,
                previewText: content.previewText,
                bodyText: content.bodyText,
            },
            requestPayload: {
                kind: "welcome-sequence",
                phaseId: input.phase.id,
                recipient: input.recipient,
                locale: input.locale,
            },
            idempotencyKey: `welcome-sequence:${input.userId}:${input.phase.id}`,
            scheduledPolicyId: `welcome-sequence:${input.phase.id}`,
            env,
            execute: () => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const sendResult = yield sendEmailTextMessage({
                    config: emailConfig,
                    to: input.recipient,
                    subject: content.subject,
                    text: content.bodyText,
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
    });
}
export function sendWelcomeEmail(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const phaseId = (_a = input.phaseId) !== null && _a !== void 0 ? _a : "day0";
        const phase = WELCOME_SEQUENCE.find((item) => item.id === phaseId);
        if (!phase) {
            throw new Error(`Unknown welcome sequence phase "${phaseId}".`);
        }
        return sendWelcomeEmailForPhase({
            recipient: input.recipient,
            userId: input.userId,
            userName: input.userName,
            locale: normalizeLocale(input.locale),
            phase,
            env: input.env,
        });
    });
}
export function runWeeklyDigestEmails(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const now = (_b = input.now) !== null && _b !== void 0 ? _b : new Date();
        const emailConfig = yield getEmailConfig(env);
        const recipients = yield prisma.user.findMany({
            where: {
                email: {
                    not: null,
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                preference: {
                    select: {
                        emailDigest: true,
                        aiResponseLocale: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        const localeBriefCache = new Map();
        const results = [];
        let delivered = 0;
        let replayed = 0;
        let failed = 0;
        let skipped = 0;
        for (const recipient of recipients) {
            const email = (_c = recipient.email) === null || _c === void 0 ? void 0 : _c.trim();
            if (!email || ((_d = recipient.preference) === null || _d === void 0 ? void 0 : _d.emailDigest) === false) {
                skipped += 1;
                continue;
            }
            const locale = normalizeLocale((_e = recipient.preference) === null || _e === void 0 ? void 0 : _e.aiResponseLocale);
            let brief = localeBriefCache.get(locale);
            if (!brief) {
                brief = yield generatePortfolioBrief({ locale });
                localeBriefCache.set(locale, brief);
            }
            const digestContent = brief.formats.emailDigest;
            const weekWindowKey = weekKey(now);
            try {
                const execution = yield executeBriefDelivery({
                    channel: "email",
                    provider: "smtp",
                    mode: "scheduled",
                    scope: "portfolio",
                    locale,
                    target: email,
                    headline: brief.headline,
                    content: {
                        subject: digestContent.subject,
                        previewText: digestContent.preview,
                        bodyText: digestContent.body,
                    },
                    requestPayload: {
                        kind: "weekly-digest",
                        recipient: email,
                        locale,
                        weekWindowKey,
                    },
                    idempotencyKey: `weekly-digest:${recipient.id}:${weekWindowKey}`,
                    scheduledPolicyId: "weekly-digest",
                    env,
                    execute: () => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        const sendResult = yield sendEmailTextMessage({
                            config: emailConfig,
                            to: email,
                            subject: digestContent.subject,
                            text: digestContent.body,
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
                if (execution.replayed) {
                    replayed += 1;
                }
                else {
                    delivered += 1;
                }
                results.push({
                    userId: recipient.id,
                    email,
                    locale,
                    delivered: !execution.replayed,
                    replayed: execution.replayed,
                    messageId: execution.providerMessageId,
                    error: null,
                });
            }
            catch (error) {
                failed += 1;
                results.push({
                    userId: recipient.id,
                    email,
                    locale,
                    delivered: false,
                    replayed: false,
                    messageId: null,
                    error: error instanceof Error ? error.message : "Digest delivery failed.",
                });
            }
        }
        return {
            checked: recipients.length,
            delivered,
            replayed,
            failed,
            skipped,
            timestamp: now.toISOString(),
            results,
        };
    });
}
export function sendTelegramMorningBrief(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const now = (_b = input.now) !== null && _b !== void 0 ? _b : new Date();
        return deliverBriefToTelegram({
            scope: "portfolio",
            locale: normalizeLocale(env.BRIEF_LOCALE),
            idempotencyKey: `telegram-morning-brief:${dayKey(now)}`,
            scheduledPolicyId: "telegram-morning-brief",
        });
    });
}
export function runDueWelcomeSequenceEmails(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const env = (_a = input.env) !== null && _a !== void 0 ? _a : process.env;
        const now = (_b = input.now) !== null && _b !== void 0 ? _b : new Date();
        const users = yield prisma.user.findMany({
            where: {
                email: {
                    not: null,
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                preference: {
                    select: {
                        emailDigest: true,
                        aiResponseLocale: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        const results = [];
        let delivered = 0;
        let replayed = 0;
        let failed = 0;
        let skipped = 0;
        const phases = WELCOME_SEQUENCE.filter((phase) => phase.dayOffset > 0);
        for (const user of users) {
            const email = (_c = user.email) === null || _c === void 0 ? void 0 : _c.trim();
            if (!email || ((_d = user.preference) === null || _d === void 0 ? void 0 : _d.emailDigest) === false) {
                skipped += 1;
                continue;
            }
            const locale = normalizeLocale((_e = user.preference) === null || _e === void 0 ? void 0 : _e.aiResponseLocale);
            const ageDays = daysSince(user.createdAt, now);
            const userName = ((_f = user.name) === null || _f === void 0 ? void 0 : _f.trim()) || (locale === "ru" ? "друг" : "friend");
            const duePhases = phases.filter((phase) => ageDays >= phase.dayOffset);
            if (!duePhases.length) {
                skipped += 1;
                continue;
            }
            for (const phase of duePhases) {
                try {
                    const execution = yield sendWelcomeEmailForPhase({
                        recipient: email,
                        userId: user.id,
                        userName,
                        locale,
                        phase,
                        env,
                    });
                    if (execution.replayed) {
                        replayed += 1;
                        results.push({
                            userId: user.id,
                            email,
                            phaseId: phase.id,
                            delivered: false,
                            replayed: true,
                            messageId: execution.providerMessageId,
                            error: null,
                        });
                        continue;
                    }
                    delivered += 1;
                    results.push({
                        userId: user.id,
                        email,
                        phaseId: phase.id,
                        delivered: true,
                        replayed: false,
                        messageId: execution.providerMessageId,
                        error: null,
                    });
                    break;
                }
                catch (error) {
                    failed += 1;
                    results.push({
                        userId: user.id,
                        email,
                        phaseId: phase.id,
                        delivered: false,
                        replayed: false,
                        messageId: null,
                        error: error instanceof Error ? error.message : "Welcome delivery failed.",
                    });
                    break;
                }
            }
        }
        return {
            checked: users.length,
            delivered,
            replayed,
            failed,
            skipped,
            timestamp: now.toISOString(),
            results,
        };
    });
}
