/**
 * Timeline Types
 * Type definitions for project timeline visualization
 */
export interface ProjectTimeline {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    progress: number;
    status: 'planning' | 'active' | 'completed' | 'delayed';
    milestones?: TimelineMilestone[];
}
export interface TimelineMilestone {
    id: string;
    name: string;
    date: Date;
}
export interface TimelineDataResponse {
    projects: ProjectTimeline[];
}
export declare const STATUS_LABELS: Record<ProjectTimeline['status'], string>;
export declare const STATUS_COLORS: Record<ProjectTimeline['status'], string>;
//# sourceMappingURL=timeline.d.ts.map