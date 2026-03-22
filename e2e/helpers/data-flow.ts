import { expect, type Page } from "@playwright/test";

type TeamApiResponse = {
  team: Array<{
    id: string;
    name: string;
  }>;
};

type ProjectsApiResponse = {
  projects: Array<{
    id: string;
    name: string;
    progress: number;
    status: string;
  }>;
};

type TasksApiResponse = {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    projectId: string;
  }>;
};

type AnalyticsOverviewResponse = {
  summary: {
    totalTasks: number;
    completedTasks: number;
    activeProjects: number;
    planFact: Record<string, number>;
  };
  projects: Array<{
    projectId: string;
    projectName: string;
    totalTasks: number;
    statusBreakdown: {
      todo: number;
      inProgress: number;
      blocked: number;
      done: number;
    };
  }>;
};

export function isoDateFromToday(daysAhead: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysAhead);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getPrimaryTeamMemberName(page: Page): Promise<string> {
  const response = await page.request.get("/api/team");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as TeamApiResponse;
  const member = payload.team.find((item) => item.name.trim().length > 0);
  if (!member) {
    throw new Error("No team members are available for the integration flow.");
  }

  return member.name;
}

export async function getProjectByName(page: Page, projectName: string): Promise<{
  id: string;
  name: string;
  progress: number;
  status: string;
}> {
  const response = await page.request.get("/api/projects");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as ProjectsApiResponse;
  const project = payload.projects.find((item) => item.name === projectName);
  if (!project) {
    throw new Error(`Project not found in API payload: ${projectName}`);
  }

  return project;
}

export async function getTaskByTitle(page: Page, taskTitle: string): Promise<{
  id: string;
  title: string;
  status: string;
  projectId: string;
}> {
  const response = await page.request.get("/api/tasks");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as TasksApiResponse;
  const task = payload.tasks.find((item) => item.title === taskTitle);
  if (!task) {
    throw new Error(`Task not found in API payload: ${taskTitle}`);
  }

  return task;
}

export async function getAnalyticsOverview(page: Page, projectId: string): Promise<AnalyticsOverviewResponse> {
  const response = await page.request.get(`/api/analytics/overview?projectId=${projectId}`);
  expect(response.ok()).toBeTruthy();

  return (await response.json()) as AnalyticsOverviewResponse;
}
