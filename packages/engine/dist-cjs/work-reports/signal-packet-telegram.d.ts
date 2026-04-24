import { type BriefDeliveryLedgerRecord } from '../briefs/delivery-ledger';
import { type BriefLocale } from '../briefs/locale';
import { sendTelegramTextMessage } from '../connectors/telegram-client';
import type { WorkReportSignalPacketPortable } from './types';
export interface WorkReportSignalPacketTelegramDeliveryRequest {
    packet: WorkReportSignalPacketPortable;
    locale?: BriefLocale;
    chatId?: string | null;
    dryRun?: boolean;
    idempotencyKey?: string;
}
export interface WorkReportSignalPacketTelegramDeliveryResult {
    reportId: string;
    packetId: string;
    locale: BriefLocale;
    headline: string;
    delivered: boolean;
    dryRun: boolean;
    chatId: string | null;
    messageText: string;
    messageId?: number;
    replayed?: boolean;
    ledger?: BriefDeliveryLedgerRecord | null;
}
interface WorkReportSignalPacketTelegramDeliveryDeps {
    env?: NodeJS.ProcessEnv;
    sendMessage?: typeof sendTelegramTextMessage;
}
export declare function deliverWorkReportSignalPacketToTelegram(request: WorkReportSignalPacketTelegramDeliveryRequest, deps?: WorkReportSignalPacketTelegramDeliveryDeps): Promise<WorkReportSignalPacketTelegramDeliveryResult>;
export {};
//# sourceMappingURL=signal-packet-telegram.d.ts.map