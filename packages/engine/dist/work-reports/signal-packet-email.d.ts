import { type BriefDeliveryLedgerRecord } from '../briefs/delivery-ledger';
import { type BriefLocale } from '../briefs/locale';
import { sendEmailTextMessage } from '../connectors/email-client';
import type { WorkReportSignalPacketPortable } from './types';
export interface WorkReportSignalPacketEmailDeliveryRequest {
    packet: WorkReportSignalPacketPortable;
    locale?: BriefLocale;
    recipient?: string | null;
    dryRun?: boolean;
    idempotencyKey?: string;
}
export interface WorkReportSignalPacketEmailDeliveryResult {
    reportId: string;
    packetId: string;
    locale: BriefLocale;
    headline: string;
    delivered: boolean;
    dryRun: boolean;
    recipient: string | null;
    subject: string;
    previewText: string;
    bodyText: string;
    messageId?: string;
    replayed?: boolean;
    ledger?: BriefDeliveryLedgerRecord | null;
}
interface WorkReportSignalPacketEmailDeliveryDeps {
    env?: NodeJS.ProcessEnv;
    sendMessage?: typeof sendEmailTextMessage;
}
export declare function deliverWorkReportSignalPacketByEmail(request: WorkReportSignalPacketEmailDeliveryRequest, deps?: WorkReportSignalPacketEmailDeliveryDeps): Promise<WorkReportSignalPacketEmailDeliveryResult>;
export {};
//# sourceMappingURL=signal-packet-email.d.ts.map