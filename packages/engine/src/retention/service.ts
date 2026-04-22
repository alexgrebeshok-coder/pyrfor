import { prisma } from "@/lib/prisma";

import { executeBriefDelivery } from "@/lib/briefs/delivery-ledger";
import { generatePortfolioBrief } from "@/lib/briefs/generate";
import { resolveBriefLocale, type BriefLocale } from "@/lib/briefs/locale";
import { deliverBriefToTelegram } from "@/lib/briefs/telegram-delivery";
import {
  getEmailConnectorConfig,
  sendEmailTextMessage,
} from "@/lib/connectors/email-client";
import { siteUrl } from "@/lib/site-url";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionLocale = BriefLocale;

export interface RetentionExecutionResult<T = unknown> {
  checked: number;
  delivered: number;
  replayed: number;
  skipped: number;
  failed: number;
  timestamp: string;
  results: T[];
}

export type WelcomeSequencePhaseId = "day0" | "day1" | "day3" | "day7" | "day14";

interface WelcomeEmailContent {
  subject: string;
  previewText: string;
  bodyText: string;
  headline: string;
}

interface WelcomeEmailPhase {
  id: WelcomeSequencePhaseId;
  dayOffset: number;
  content: (input: { name: string; locale: RetentionLocale }) => WelcomeEmailContent;
}

interface WelcomeEmailResult {
  userId: string;
  email: string;
  phaseId: WelcomeSequencePhaseId;
  delivered: boolean;
  replayed: boolean;
  messageId: string | null;
  error: string | null;
}

interface DigestResult {
  userId: string;
  email: string;
  locale: RetentionLocale;
  delivered: boolean;
  replayed: boolean;
  messageId: string | null;
  error: string | null;
}

const WELCOME_SEQUENCE: WelcomeEmailPhase[] = [
  {
    id: "day0",
    dayOffset: 0,
    content: ({ name, locale }) => {
      const intro = locale === "ru" ? "Добро пожаловать" : "Welcome";
      const subject =
        locale === "ru"
          ? "Добро пожаловать в CEOClaw — начнём с первого шага"
          : "Welcome to CEOClaw — let’s make the first step useful";
      const previewText =
        locale === "ru"
          ? "Покажем, где начать и как быстро получить пользу от первого проекта."
          : "A quick path to your first useful project and weekly brief.";
      const bodyText =
        locale === "ru"
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
      const subject =
        locale === "ru"
          ? "Ваш первый проект в CEOClaw"
          : "Your first project in CEOClaw";
      const previewText =
        locale === "ru"
          ? "Шаблон проекта и план первых действий уже готовы."
          : "Your project template and next steps are ready.";
      const bodyText =
        locale === "ru"
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
      const subject =
        locale === "ru"
          ? "Проверьте AI briefs и финансовый контур"
          : "Check AI briefs and the financial view";
      const previewText =
        locale === "ru"
          ? "Короткий способ увидеть план-факт, сигналы и следующий шаг."
          : "A quick way to see plan-vs-fact, signals, and next steps.";
      const bodyText =
        locale === "ru"
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
      const subject =
        locale === "ru"
          ? "Подключите ежедневные briefs"
          : "Connect daily briefs";
      const previewText =
        locale === "ru"
          ? "Telegram и email-сводки помогают возвращать команду в ритм."
          : "Telegram and email briefs help keep the team in rhythm.";
      const bodyText =
        locale === "ru"
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
      const subject =
        locale === "ru"
          ? "Две недели с CEOClaw — пора масштабировать"
          : "Two weeks with CEOClaw — time to scale";
      const previewText =
        locale === "ru"
          ? "Если продукт полезен, следующий шаг — поднять лимиты и открыть billing."
          : "If the product is useful, the next step is to raise limits and check billing.";
      const bodyText =
        locale === "ru"
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

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekKey(date: Date): string {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() - (weekday - 1));
  return normalized.toISOString().slice(0, 10);
}

function daysSince(start: Date, now: Date) {
  return Math.floor((now.getTime() - start.getTime()) / DAY_MS);
}

function normalizeLocale(value: string | null | undefined): RetentionLocale {
  return resolveBriefLocale(value);
}

async function getEmailConfig(env: NodeJS.ProcessEnv) {
  const config = getEmailConnectorConfig(env);
  if (!config) {
    throw new Error("SMTP is not configured.");
  }

  return config;
}

function buildWelcomeEmailContent(
  phase: WelcomeEmailPhase,
  userName: string,
  locale: RetentionLocale
): WelcomeEmailContent {
  return phase.content({
    name: userName,
    locale,
  });
}

async function sendWelcomeEmailForPhase(input: {
  recipient: string;
  userId: string;
  userName: string;
  locale: RetentionLocale;
  phase: WelcomeEmailPhase;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const emailConfig = await getEmailConfig(env);
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
    execute: async () => {
      const sendResult = await sendEmailTextMessage({
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
          messageId: sendResult.messageId ?? null,
        },
      };
    },
  });
}

export async function sendWelcomeEmail(input: {
  recipient: string;
  userId: string;
  userName: string;
  locale?: string | null;
  phaseId?: WelcomeSequencePhaseId;
  env?: NodeJS.ProcessEnv;
}) {
  const phaseId = input.phaseId ?? "day0";
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
}

export async function runWeeklyDigestEmails(input: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const emailConfig = await getEmailConfig(env);
  const recipients = await prisma.user.findMany({
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

  const localeBriefCache = new Map<RetentionLocale, Awaited<ReturnType<typeof generatePortfolioBrief>>>();
  const results: DigestResult[] = [];
  let delivered = 0;
  let replayed = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const email = recipient.email?.trim();
    if (!email || recipient.preference?.emailDigest === false) {
      skipped += 1;
      continue;
    }

    const locale = normalizeLocale(recipient.preference?.aiResponseLocale);
    let brief = localeBriefCache.get(locale);
    if (!brief) {
      brief = await generatePortfolioBrief({ locale });
      localeBriefCache.set(locale, brief);
    }
    const digestContent = brief.formats.emailDigest;
    const weekWindowKey = weekKey(now);

    try {
      const execution = await executeBriefDelivery({
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
        execute: async () => {
          const sendResult = await sendEmailTextMessage({
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
              messageId: sendResult.messageId ?? null,
            },
          };
        },
      });

      if (execution.replayed) {
        replayed += 1;
      } else {
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
    } catch (error) {
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
  } satisfies RetentionExecutionResult<DigestResult>;
}

export async function sendTelegramMorningBrief(input: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();

  return deliverBriefToTelegram({
    scope: "portfolio",
    locale: normalizeLocale(env.BRIEF_LOCALE),
    idempotencyKey: `telegram-morning-brief:${dayKey(now)}`,
    scheduledPolicyId: "telegram-morning-brief",
  });
}

export async function runDueWelcomeSequenceEmails(input: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const users = await prisma.user.findMany({
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

  const results: WelcomeEmailResult[] = [];
  let delivered = 0;
  let replayed = 0;
  let failed = 0;
  let skipped = 0;

  const phases = WELCOME_SEQUENCE.filter((phase) => phase.dayOffset > 0);

  for (const user of users) {
    const email = user.email?.trim();
    if (!email || user.preference?.emailDigest === false) {
      skipped += 1;
      continue;
    }

    const locale = normalizeLocale(user.preference?.aiResponseLocale);
    const ageDays = daysSince(user.createdAt, now);
    const userName = user.name?.trim() || (locale === "ru" ? "друг" : "friend");
    const duePhases = phases.filter((phase) => ageDays >= phase.dayOffset);

    if (!duePhases.length) {
      skipped += 1;
      continue;
    }

    for (const phase of duePhases) {
      try {
        const execution = await sendWelcomeEmailForPhase({
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
      } catch (error) {
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
  } satisfies RetentionExecutionResult<WelcomeEmailResult>;
}
