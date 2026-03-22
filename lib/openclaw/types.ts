export type Intent = 'add_task' | 'update_budget' | 'show_status' | 'create_project' | 'assign_task' | 'unknown';

export interface CommandResult {
  message: string;
  success: boolean;
}

export interface EntityMap {
  project?: string;
  task?: string;
  budget?: string;
  person?: string;
  amount?: string;
}
