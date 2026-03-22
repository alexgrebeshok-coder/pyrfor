export type ProjectStatus =
  | "active"
  | "planning"
  | "on-hold"
  | "completed"
  | "at-risk";

/**
 * Роли пользователей в системе
 * - EXEC: Гендиректор (полный доступ ко всем проектам)
 * - CURATOR: Куратор проекта (просмотр + ограниченные права редактирования)
 * - PM: Руководитель проекта (полный доступ к своим проектам)
 * - MEMBER: Исполнитель (только свои задачи и проекты)
 * - SOLO: Одиночка (персональное рабочее пространство)
 */
export type UserRole = "EXEC" | "CURATOR" | "PM" | "MEMBER" | "SOLO";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

export type ProjectDirection =
  | "metallurgy"
  | "logistics"
  | "trade"
  | "construction";

export type Priority = "low" | "medium" | "high" | "critical";

export type TaskStatus = "todo" | "in-progress" | "done" | "blocked";

export type RiskStatus = "open" | "mitigating" | "mitigated" | "closed";

export type Severity = "info" | "warning" | "critical";

export interface Budget {
  planned: number;
  actual: number;
  currency: string;
}

export interface MilestoneRef {
  name: string;
  date: string;
}

export interface ProgressPoint {
  date: string;
  progress: number;
  budgetPlanned: number;
  budgetActual: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  direction: ProjectDirection;
  budget: Budget;
  dates: { start: string; end: string };
  nextMilestone: MilestoneRef | null;
  team: string[];
  risks: number;
  location: string;
  priority: Priority;
  health: number;
  objectives: string[];
  materials: number;
  laborProductivity: number;
  safety: { ltifr: number; trir: number };
  history: ProgressPoint[];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  order: number;
  assignee: {
    id: string;
    name: string;
    initials?: string | null;
  } | null;
  dueDate: string;
  priority: Priority;
  tags: string[];
  createdAt: string;
  blockedReason?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  capacity: number;
  allocated: number;
  projects: string[];
  location: string;
}

export interface Risk {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  ownerId?: string | null;
  owner: string;
  probability: number;
  impact: number;
  status: RiskStatus;
  mitigation: string;
  category: string;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  title: string;
  type: string;
  owner: string;
  updatedAt: string;
  size: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  start: string;
  end: string;
  status: ProjectStatus;
  progress: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  createdAt: string;
  projectId?: string;
}

export interface AuditLogEntry {
  id: string;
  projectId: string;
  action: string;
  userId: string;
  userName: string;
  timestamp: string;
  details: string;
}

export interface DashboardState {
  currentUser: User;
  projects: Project[];
  tasks: Task[];
  team: TeamMember[];
  risks: Risk[];
  documents: ProjectDocument[];
  milestones: Milestone[];
  auditLogEntries: AuditLogEntry[];
}

export interface ProjectFormValues {
  name: string;
  description: string;
  direction: ProjectDirection;
  plannedBudget: number;
  actualBudget: number;
  currency: string;
  start: string;
  end: string;
  team: string[];
  location: string;
  priority: Priority;
  status: ProjectStatus;
  progress: number;
}

// ============================================
// AI-PMO Types: EVM Metrics & Health Scores
// ============================================

/**
 * Earned Value Management (EVM) metrics
 * - EV (Earned Value): Budgeted cost of work performed
 * - PV (Planned Value): Budgeted cost of work scheduled
 * - AC (Actual Cost): Actual cost of work performed
 * - CPI (Cost Performance Index): EV / AC (>1 = under budget)
 * - SPI (Schedule Performance Index): EV / PV (>1 = ahead of schedule)
 * - EAC (Estimate at Completion): Expected total cost
 */
export interface EVMMetrics {
  /** Earned Value (выполненная работа в деньгах) */
  ev: number;
  /** Planned Value (запланированная работа в деньгах) */
  pv: number;
  /** Actual Cost (фактические затраты) */
  ac: number;
  /** Cost Performance Index (CPI = EV / AC, >1 хорошо) */
  cpi: number;
  /** Schedule Performance Index (SPI = EV / PV, >1 хорошо) */
  spi: number;
  /** Estimate at Completion (прогноз полного бюджета) */
  eac: number;
  /** Variance at Completion (отклонение от плана) */
  vac: number;
  /** Percent complete (процент выполнения по EVM) */
  percentComplete: number;
}

/**
 * Budget forecast for project completion
 */
export interface BudgetForecast {
  /** Estimated final cost */
  estimatedTotal: number;
  /** Original budget */
  originalBudget: number;
  /** Variance (positive = under budget, negative = over budget) */
  variance: number;
  /** Variance percentage */
  variancePercent: number;
  /** Forecast date */
  forecastDate: string;
  /** Confidence level (0-100) */
  confidence: number;
}

/**
 * Project health score breakdown
 * - Overall health (0-100)
 * - Budget health (0-100)
 * - Schedule health (0-100)
 * - Risk health (0-100)
 */
export interface ProjectHealth {
  /** Overall health score (0-100) */
  overall: number;
  /** Budget health score (0-100) */
  budget: number;
  /** Schedule health score (0-100) */
  schedule: number;
  /** Risk health score (0-100) */
  risks: number;
  /** Health trend: improving, stable, declining */
  trend: "improving" | "stable" | "declining";
  /** Last calculated timestamp */
  calculatedAt: string;
}

/**
 * Auto-detected risk from monitoring agent
 */
export interface AutoRisk {
  id: string;
  projectId: string;
  type: "schedule" | "budget" | "resource" | "scope";
  severity: Severity;
  title: string;
  description: string;
  detectedAt: string;
  probability: number;
  impact: number;
  recommendation: string;
}

/**
 * Portfolio health summary
 */
export interface PortfolioHealth {
  /** Overall portfolio health (0-100) */
  overall: number;
  /** Number of healthy projects */
  healthy: number;
  /** Number of at-risk projects */
  atRisk: number;
  /** Number of critical projects */
  critical: number;
  /** Total budget variance */
  budgetVariance: number;
  /** Average schedule variance */
  scheduleVariance: number;
  /** AI-generated insights */
  insights: string[];
}

// ============================================
// KANBAN TYPES
// ============================================

export interface Board {
  id: string;
  name: string;
  projectId: string;
  project?: {
    id: string;
    name: string;
    status?: ProjectStatus;
    progress?: number;
  };
  columns: Column[];
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  title: string;
  order: number;
  color?: string;
  boardId: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  id: string;
  type: "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH";
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
}
