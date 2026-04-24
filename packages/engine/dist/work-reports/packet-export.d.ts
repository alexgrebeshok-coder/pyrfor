import type { WorkReportSignalPacketExportFormat, WorkReportSignalPacketPortable } from './types';
export interface WorkReportSignalPacketExportArtifact {
    content: string;
    contentType: string;
    fileExtension: string;
    fileName: string;
}
export declare function exportWorkReportSignalPacket(packet: WorkReportSignalPacketPortable, format: WorkReportSignalPacketExportFormat): WorkReportSignalPacketExportArtifact;
export declare function buildWorkReportSignalPacketMarkdown(packet: WorkReportSignalPacketPortable): string;
//# sourceMappingURL=packet-export.d.ts.map