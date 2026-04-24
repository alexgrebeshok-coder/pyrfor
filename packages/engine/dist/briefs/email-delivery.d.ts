import { generatePortfolioBrief, generateProjectBrief } from './generate';
import { type BriefDeliveryLedgerRecord } from './delivery-ledger';
import { type BriefLocale } from './locale';
import { sendEmailTextMessage } from '../connectors/email-client';
type EmailDeliveryScope = "portfolio" | "project";
export interface EmailBriefDeliveryRequest {
    scope: EmailDeliveryScope;
    projectId?: string;
    locale?: BriefLocale;
    recipient?: string | null;
    dryRun?: boolean;
    idempotencyKey?: string;
}
export interface EmailBriefDeliveryResult {
    scope: EmailDeliveryScope;
    locale: BriefLocale;
    recipient: string | null;
    headline: string;
    delivered: boolean;
    dryRun: boolean;
    subject: string;
    previewText: string;
    bodyText: string;
    messageId?: string;
    replayed?: boolean;
    ledger?: BriefDeliveryLedgerRecord | null;
}
interface EmailBriefDeliveryDeps {
    env?: NodeJS.ProcessEnv;
    generatePortfolio?: typeof generatePortfolioBrief;
    generateProject?: typeof generateProjectBrief;
    sendMessage?: typeof sendEmailTextMessage;
}
export declare function deliverBriefByEmail(request: EmailBriefDeliveryRequest, deps?: EmailBriefDeliveryDeps): Promise<EmailBriefDeliveryResult>;
export {};
//# sourceMappingURL=email-delivery.d.ts.map