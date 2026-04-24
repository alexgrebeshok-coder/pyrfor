import { type BriefLocale } from '../briefs/locale';
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
export declare function sendWelcomeEmail(input: {
    recipient: string;
    userId: string;
    userName: string;
    locale?: string | null;
    phaseId?: WelcomeSequencePhaseId;
    env?: NodeJS.ProcessEnv;
}): Promise<{
    ledger: null;
    replayed: false;
    providerMessageId: string | null;
} | {
    ledger: import("../briefs/delivery-ledger").BriefDeliveryLedgerRecord;
    replayed: true;
    providerMessageId: string | null;
} | {
    ledger: import("../briefs/delivery-ledger").BriefDeliveryLedgerRecord;
    replayed: false;
    providerMessageId: string | null;
}>;
export declare function runWeeklyDigestEmails(input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
}): Promise<{
    checked: number;
    delivered: number;
    replayed: number;
    failed: number;
    skipped: number;
    timestamp: string;
    results: DigestResult[];
}>;
export declare function sendTelegramMorningBrief(input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
}): Promise<import("../briefs/telegram-delivery").TelegramBriefDeliveryResult>;
export declare function runDueWelcomeSequenceEmails(input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
}): Promise<{
    checked: number;
    delivered: number;
    replayed: number;
    failed: number;
    skipped: number;
    timestamp: string;
    results: WelcomeEmailResult[];
}>;
export {};
//# sourceMappingURL=service.d.ts.map