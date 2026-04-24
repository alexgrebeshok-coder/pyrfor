/**
 * Team Performance Types
 * Type definitions for team performance analytics
 */
export interface TeamMemberPerformance {
    memberId: string;
    memberName: string;
    memberInitials?: string | null;
    role?: string | null;
    performanceScore: number;
    metrics: {
        totalTasks: number;
        completedTasks: number;
        inProgressTasks: number;
        overdueTasks: number;
        completionRate: number;
    };
    time: {
        totalHoursLogged: number;
        billableHours: number;
    };
    utilization?: number;
    trend?: 'up' | 'down' | 'stable';
}
export interface TeamPerformanceSummary {
    totalMembers: number;
    totalTasks: number;
    totalCompleted: number;
    totalHoursLogged: number;
    avgPerformanceScore: number;
}
export interface TeamPerformanceResponse {
    summary: TeamPerformanceSummary;
    members: TeamMemberPerformance[];
}
export interface TeamBarChartData {
    name: string;
    Утилизация: number;
    Выполнение: number;
}
export interface TeamRadarChartData {
    metric: string;
    value: number;
    fullMark?: number;
}
//# sourceMappingURL=team-performance.d.ts.map