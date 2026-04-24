import type { AIContextSnapshot, AIRunInput, AIRunRecord } from '../ai/types';
import { type ExecutiveSnapshot } from '../briefs/types';
import type { Locale } from '../utils/translations';
import type { WorkReportSignalPacket, WorkReportSignalPacketRequest, WorkReportSignalRunBlueprint, WorkReportSignalSnapshot, WorkReportView } from "./types";
interface WorkReportSignalPacketDeps {
    createRun?: (input: AIRunInput) => Promise<AIRunRecord>;
    loadContext?: (input: {
        projectId: string;
        locale?: Locale;
        interfaceLocale?: Locale;
        subtitle?: string;
        title?: string;
    }) => Promise<AIContextSnapshot>;
    loadSnapshot?: (input: {
        projectId: string;
    }) => Promise<ExecutiveSnapshot>;
    loadWorkReport?: (reportId: string) => Promise<WorkReportView | null>;
    now?: () => Date;
    packetIdFactory?: () => string;
}
export declare function createWorkReportSignalPacket(reportId: string, request?: WorkReportSignalPacketRequest, deps?: WorkReportSignalPacketDeps): Promise<WorkReportSignalPacket>;
export declare function buildWorkReportSignalRunBlueprints(context: AIContextSnapshot, report: WorkReportView, signal: WorkReportSignalSnapshot, locale: Locale | undefined, traceMeta: {
    packetId: string;
}): WorkReportSignalRunBlueprint[];
export {};
//# sourceMappingURL=signal-packet.d.ts.map