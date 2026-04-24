"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportWorkReportSignalPacket = exportWorkReportSignalPacket;
exports.buildWorkReportSignalPacketMarkdown = buildWorkReportSignalPacketMarkdown;
function exportWorkReportSignalPacket(packet, format) {
    const fileBaseName = buildFileBaseName(packet);
    if (format === "json") {
        return {
            content: `${JSON.stringify(packet, null, 2)}\n`,
            contentType: "application/json; charset=utf-8",
            fileExtension: "json",
            fileName: `${fileBaseName}.json`,
        };
    }
    return {
        content: buildWorkReportSignalPacketMarkdown(packet),
        contentType: "text/markdown; charset=utf-8",
        fileExtension: "md",
        fileName: `${fileBaseName}.md`,
    };
}
function buildWorkReportSignalPacketMarkdown(packet) {
    const lines = [
        `# Signal packet · ${packet.reportNumber}`,
        "",
        `- Project: ${packet.projectName}`,
        `- Report status: ${packet.reportStatus}`,
        `- Created at: ${packet.createdAt}`,
        `- Packet ID: ${packet.packetId}`,
        "",
        "## Headline",
        "",
        packet.signal.headline,
        "",
        "## Summary",
        "",
        packet.signal.summary,
        "",
        "## Plan-fact snapshot",
        "",
        `- Planned progress: ${packet.signal.planFact.plannedProgress}%`,
        `- Actual progress: ${packet.signal.planFact.actualProgress}%`,
        `- Progress variance: ${packet.signal.planFact.progressVariance} pp`,
        `- Pending work reports: ${packet.signal.planFact.pendingWorkReports}`,
        `- Days since last approved report: ${packet.signal.planFact.daysSinceLastApprovedReport ?? "n/a"}`,
        "",
        "## Top alerts",
        "",
    ];
    if (packet.signal.topAlerts.length === 0) {
        lines.push("- No active alerts.");
    }
    else {
        packet.signal.topAlerts.forEach((alert, index) => {
            lines.push(`${index + 1}. [${alert.severity.toUpperCase()}] ${alert.title} — ${alert.summary}`);
        });
    }
    lines.push("", "## Run outputs", "");
    packet.runs.forEach((entry) => {
        lines.push(`### ${entry.label}`);
        lines.push("");
        lines.push(`- Purpose: ${entry.purpose}`);
        lines.push(`- Status: ${entry.run.status}`);
        lines.push(`- Poll path: ${entry.pollPath}`);
        lines.push(`- Summary: ${entry.run.result?.summary ?? "AI run has not returned a summary yet."}`);
        const proposal = entry.run.result?.proposal;
        if (proposal) {
            lines.push(`- Proposal: ${proposal.title}`);
            lines.push(`- Proposal state: ${proposal.state}`);
            lines.push(`- Proposal summary: ${proposal.summary}`);
        }
        lines.push("");
    });
    return `${lines.join("\n")}\n`;
}
function buildFileBaseName(packet) {
    const reportNumber = packet.reportNumber.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
    const packetId = packet.packetId.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
    return `${reportNumber || "work-report"}-signal-packet-${packetId || "export"}`;
}
