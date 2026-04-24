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
    }): Promise<{
        messageId?: string;
    }>;
    close?(): void | Promise<void>;
}
export type EmailTransportFactory = (config: EmailConnectorConfig) => EmailTransportLike;
export declare function setEmailTransportFactoryForTests(factory: EmailTransportFactory | null): void;
export declare function getEmailFrom(env?: NodeJS.ProcessEnv): string | null;
export declare function getEmailDefaultTo(env?: NodeJS.ProcessEnv): string | null;
export declare function getSmtpHost(env?: NodeJS.ProcessEnv): string | null;
export declare function getSmtpUser(env?: NodeJS.ProcessEnv): string | null;
export declare function getSmtpPassword(env?: NodeJS.ProcessEnv): string | null;
export declare function getSmtpPort(env?: NodeJS.ProcessEnv): number;
export declare function getSmtpSecure(env?: NodeJS.ProcessEnv): boolean;
export declare function getEmailConnectorMissingSecrets(env?: NodeJS.ProcessEnv): string[];
export declare function getEmailConnectorConfig(env?: NodeJS.ProcessEnv): EmailConnectorConfig | null;
export declare function probeEmailTransport(config: EmailConnectorConfig, factory?: EmailTransportFactory): Promise<{
    ok: true;
    remoteStatus: "ok";
    message: string;
    metadata: EmailTransportMetadata;
} | {
    ok: false;
    message: string;
    metadata: EmailTransportMetadata;
}>;
export declare function sendEmailTextMessage(input: {
    config: EmailConnectorConfig;
    to: string;
    subject: string;
    text: string;
}, factory?: EmailTransportFactory): Promise<{
    ok: true;
    messageId?: string;
} | {
    ok: false;
    message: string;
}>;
export {};
//# sourceMappingURL=email-client.d.ts.map