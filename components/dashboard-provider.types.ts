import type {
  DashboardState,
  NotificationItem,
  Priority,
  ProjectFormValues,
  ProjectStatus,
  TaskStatus,
} from "@/lib/types";

export interface AddTaskPayload {
  projectId: string;
  title: string;
  assignee: string;
  dueDate: string;
  description?: string;
  priority?: Priority;
  status?: TaskStatus;
  order?: number;
  tags?: string[];
}

export interface DashboardContextValue extends DashboardState {
  isHydrating: boolean;
  isLoading: boolean;
  error: string | null;
  isDegradedMode: boolean;
  notifications: NotificationItem[];
  retry: () => void;
  addProject: (values: ProjectFormValues) => Promise<void>;
  updateProject: (projectId: string, values: ProjectFormValues) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  duplicateProject: (projectId: string) => Promise<void>;
  addTask: (payload: AddTaskPayload) => Promise<void>;
  addTasksBatch: (payloads: AddTaskPayload[]) => Promise<void>;
  updateTaskStatus: (taskIds: string[], status: TaskStatus) => Promise<void>;
  reorderKanbanTasks: (
    projectId: string,
    nextColumns: Partial<Record<TaskStatus, string[]>>
  ) => Promise<void>;
  setProjectStatus: (projectId: string, status: ProjectStatus) => Promise<void>;
}

export type DashboardCachePayload =
  | DashboardState
  | {
      state: DashboardState;
      timestamp?: number;
    };
