import { generatePortfolioBrief, generateProjectBrief } from './generate';
import { type BriefDeliveryLedgerRecord } from './delivery-ledger';
import { type BriefLocale } from './locale';
import { sendTelegramTextMessage } from '../connectors/telegram-client';
type TelegramDeliveryScope = "portfolio" | "project";
export interface TelegramBriefDeliveryRequest {
    scope: TelegramDeliveryScope;
    projectId?: string;
    locale?: BriefLocale;
    chatId?: string | null;
    dryRun?: boolean;
    idempotencyKey?: string;
    scheduledPolicyId?: string | null;
}
export interface TelegramBriefDeliveryResult {
    scope: TelegramDeliveryScope;
    locale: BriefLocale;
    chatId: string | null;
    headline: string;
    delivered: boolean;
    dryRun: boolean;
    messageText: string;
    messageId?: number;
    replayed?: boolean;
    ledger?: BriefDeliveryLedgerRecord | null;
}
interface TelegramBriefDeliveryDeps {
    env?: NodeJS.ProcessEnv;
    sendMessage?: typeof sendTelegramTextMessage;
    generatePortfolio?: typeof generatePortfolioBrief;
    generateProject?: typeof generateProjectBrief;
}
export declare function deliverBriefToTelegram(request: TelegramBriefDeliveryRequest, deps?: TelegramBriefDeliveryDeps): Promise<TelegramBriefDeliveryResult>;
export {};
//# sourceMappingURL=telegram-delivery.d.ts.map