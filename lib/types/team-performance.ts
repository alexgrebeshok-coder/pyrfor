/**
 * Team Performance Types
 * Type definitions for team performance analytics
 */

export interface TeamMemberPerformance {
  memberId: string;
  memberName: string;
  memberInitials?: string | null;
  role?: string | null;
  performanceScore: number; // 0-100
  metrics: {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    overdueTasks: number;
    completionRate: number; // 0-100
  };
  time: {
    totalHoursLogged: number;
    billableHours: number;
  };
  // Computed fields for display
  utilization?: number; // 0-100 (derived from completion rate)
  trend?: 'up' | 'down' | 'stable'; // Placeholder for future implementation
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

// Chart data types
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
