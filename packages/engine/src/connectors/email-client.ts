import nodemailer from "nodemailer";

type EmailTransportMetadata = Record<string, string | number | boolean | null>;

export interface EmailConnectorConfig {
  from: string;
  defaultTo: string | null;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface EmailTransportLike {
  verify(): Promise<unknown>;
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
  close?(): void | Promise<void>;
}

export type EmailTransportFactory = (config: EmailConnectorConfig) => EmailTransportLike;

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SECURE_SMTP_PORT = 465;

let transportFactory: EmailTransportFactory = createNodeMailerTransport;

function createNodeMailerTransport(config: EmailConnectorConfig): EmailTransportLike {
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

function parseExplicitPort(rawValue: string | undefined): number | null {
  if (!rawValue?.trim()) {
    return null;
  }

  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseSecureFlag(rawValue: string | undefined): boolean | null {
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

async function closeTransport(transport: EmailTransportLike) {
  if (typeof transport.close === "function") {
    await transport.close();
  }
}

function buildMetadata(config: EmailConnectorConfig): EmailTransportMetadata {
  return {
    sender: config.from,
    defaultRecipient: config.defaultTo,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.user,
  };
}

export function setEmailTransportFactoryForTests(factory: EmailTransportFactory | null) {
  transportFactory = factory ?? createNodeMailerTransport;
}

export function getEmailFrom(env: NodeJS.ProcessEnv = process.env) {
  return env.EMAIL_FROM?.trim() || null;
}

export function getEmailDefaultTo(env: NodeJS.ProcessEnv = process.env) {
  return env.EMAIL_DEFAULT_TO?.trim() || null;
}

export function getSmtpHost(env: NodeJS.ProcessEnv = process.env) {
  return env.SMTP_HOST?.trim() || null;
}

export function getSmtpUser(env: NodeJS.ProcessEnv = process.env) {
  return env.SMTP_USER?.trim() || null;
}

export function getSmtpPassword(env: NodeJS.ProcessEnv = process.env) {
  return env.SMTP_PASSWORD?.trim() || null;
}

export function getSmtpPort(env: NodeJS.ProcessEnv = process.env) {
  const explicitPort = parseExplicitPort(env.SMTP_PORT);
  if (explicitPort !== null) {
    return explicitPort;
  }

  return getSmtpSecure(env) ? DEFAULT_SECURE_SMTP_PORT : DEFAULT_SMTP_PORT;
}

export function getSmtpSecure(env: NodeJS.ProcessEnv = process.env) {
  const explicitSecure = parseSecureFlag(env.SMTP_SECURE);
  if (explicitSecure !== null) {
    return explicitSecure;
  }

  return parseExplicitPort(env.SMTP_PORT) === DEFAULT_SECURE_SMTP_PORT;
}

export function getEmailConnectorMissingSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...(getEmailFrom(env) ? [] : ["EMAIL_FROM"]),
    ...(getSmtpHost(env) ? [] : ["SMTP_HOST"]),
    ...(getSmtpUser(env) ? [] : ["SMTP_USER"]),
    ...(getSmtpPassword(env) ? [] : ["SMTP_PASSWORD"]),
  ];
}

export function getEmailConnectorConfig(
  env: NodeJS.ProcessEnv = process.env
): EmailConnectorConfig | null {
  const missingSecrets = getEmailConnectorMissingSecrets(env);
  if (missingSecrets.length > 0) {
    return null;
  }

  return {
    from: getEmailFrom(env)!,
    defaultTo: getEmailDefaultTo(env),
    host: getSmtpHost(env)!,
    port: getSmtpPort(env),
    secure: getSmtpSecure(env),
    user: getSmtpUser(env)!,
    password: getSmtpPassword(env)!,
  };
}

export async function probeEmailTransport(
  config: EmailConnectorConfig,
  factory: EmailTransportFactory = transportFactory
): Promise<
  | {
      ok: true;
      remoteStatus: "ok";
      message: string;
      metadata: EmailTransportMetadata;
    }
  | {
      ok: false;
      message: string;
      metadata: EmailTransportMetadata;
    }
> {
  const transport = factory(config);

  try {
    await transport.verify();

    return {
      ok: true,
      remoteStatus: "ok",
      message: `SMTP transport verified for ${config.from} via ${config.host}:${config.port}.`,
      metadata: buildMetadata(config),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `SMTP verify failed: ${error.message}`
          : "SMTP verify failed with an unknown error.",
      metadata: buildMetadata(config),
    };
  } finally {
    await closeTransport(transport);
  }
}

export async function sendEmailTextMessage(
  input: {
    config: EmailConnectorConfig;
    to: string;
    subject: string;
    text: string;
  },
  factory: EmailTransportFactory = transportFactory
): Promise<
  | {
      ok: true;
      messageId?: string;
    }
  | {
      ok: false;
      message: string;
    }
> {
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
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `SMTP delivery failed: ${error.message}`
          : "SMTP delivery failed with an unknown error.",
    };
  } finally {
    await closeTransport(transport);
  }
}
