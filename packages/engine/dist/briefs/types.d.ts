export type AlertSeverity = "critical" | "high" | "medium" | "low";
export type RecommendationUrgency = "now" | "this_week" | "monitor";
export interface ExecutiveProject {
    id: string;
    name: string;
    description?: string;
    status: string;
    priority: string;
    progress: number;
    health: number;
    direction?: string;
    location?: string | null;
    budget: {
        planned: number;
        actual: number;
        currency: string;
    };
    dates: {
        start: string;
        end: string;
    };
    nextMilestone: {
        name: string;
        date: string;
    } | null;
    history: Array<{
        date: string;
        progress: number;
        budgetPlanned: number;
        budgetActual: number;
    }>;
}
export interface ExecutiveTask {
    id: string;
    projectId: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    createdAt: string;
    completedAt?: string | null;
    assigneeId?: string | null;
    assigneeName?: string | null;
}
export interface ExecutiveRisk {
    id: string;
    projectId: string;
    title: string;
    status: string;
    severity: number;
    probability: number;
    impact: number;
    mitigation?: string;
    owner?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ExecutiveMilestone {
    id: string;
    projectId: string;
    title: string;
    date: string;
    status: string;
    updatedAt: string;
}
export interface ExecutiveWorkReport {
    id: string;
    projectId: string;
    reportNumber: string;
    reportDate: string;
    status: string;
    source: string;
    authorId: string;
    reviewerId?: string | null;
    submittedAt: string;
    reviewedAt?: string | null;
}
export interface ExecutiveTeamMember {
    id: string;
    name: string;
    role?: string;
    capacity: number;
    allocated: number;
    projectIds: string[];
}
export interface ExecutiveSnapshot {
    generatedAt: string;
    projects: ExecutiveProject[];
    tasks: ExecutiveTask[];
    risks: ExecutiveRisk[];
    milestones: ExecutiveMilestone[];
    workReports: ExecutiveWorkReport[];
    teamMembers: ExecutiveTeamMember[];
}
export interface PrioritizedAlert {
    id: string;
    scope: "portfolio" | "project";
    category: "portfolio" | "schedule" | "budget" | "risk" | "resource" | "delivery";
    severity: AlertSeverity;
    confidence: number;
    freshness: number;
    score: number;
    projectId?: string;
    projectName?: string;
    title: string;
    summary: string;
    whyItMatters: string;
    recommendedAction: string;
    detectedAt: string;
    metrics?: Record<string, number | string>;
}
export interface AlertFeed {
    generatedAt: string;
    scope: "portfolio" | "project";
    summary: {
        total: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        averageConfidence: number;
        averageFreshness: number;
    };
    alerts: PrioritizedAlert[];
    recommendationsSummary: string[];
}
export interface BriefSections {
    whatHappened: string[];
    whyItMatters: string[];
    recommendedActions: string[];
}
export interface BriefFormats {
    dashboardCard: {
        title: string;
        summary: string;
        highlights: string[];
    };
    telegramDigest: string;
    emailDigest: {
        subject: string;
        preview: string;
        body: string;
    };
}
export interface PortfolioBrief {
    kind: "portfolio";
    generatedAt: string;
    headline: string;
    summary: string;
    portfolio: {
        totalProjects: number;
        activeProjects: number;
        completedProjects: number;
        atRiskProjects: number;
        criticalProjects: number;
        overdueTasks: number;
        averageHealth: number;
        budgetVariance: number;
        budgetVarianceRatio: number;
        planFact: {
            plannedProgress: number;
            actualProgress: number;
            progressVariance: number;
            cpi: number | null;
            spi: number | null;
            projectsBehindPlan: number;
            projectsOverBudget: number;
            staleFieldReportingProjects: number;
        };
    };
    topAlerts: PrioritizedAlert[];
    recommendationsSummary: string[];
    sections: BriefSections;
    formats: BriefFormats;
}
export interface ProjectBrief {
    kind: "project";
    generatedAt: string;
    headline: string;
    summary: string;
    project: {
        id: string;
        name: string;
        status: string;
        progress: number;
        health: number;
        overdueTasks: number;
        openRisks: number;
        budgetVariance: number;
        budgetVarianceRatio: number;
        nextMilestone: {
            name: string;
            date: string;
        } | null;
        planFact: {
            plannedProgress: number;
            actualProgress: number;
            progressVariance: number;
            cpi: number | null;
            spi: number | null;
            pendingWorkReports: number;
            daysSinceLastApprovedReport: number | null;
        };
    };
    topAlerts: PrioritizedAlert[];
    recommendationsSummary: string[];
    sections: BriefSections;
    formats: BriefFormats;
}
//# sourceMappingURL=types.d.ts.map