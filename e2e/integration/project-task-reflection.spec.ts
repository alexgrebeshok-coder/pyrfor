import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

type ApiProject = {
  id: string;
  name: string;
};

type ApiTask = {
  id: string;
  title: string;
  status: string;
  projectId: string;
  dueDate: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  status: string;
  kind: "task" | "milestone";
  resource: {
    projectId: string;
    projectName: string;
  };
};

type ApiProjectDetails = {
  id: string;
  milestones?: Array<{
    id: string;
    title: string;
    status: string;
    projectId: string;
  }>;
};

type GanttTask = {
  id: string;
  name: string;
  progress: number;
  type?: string;
  projectId?: string;
};

type GanttSnapshot = {
  tasks?: GanttTask[];
};

type AnalyticsProject = {
  projectId: string;
  projectName: string;
  totalTasks: number;
  statusBreakdown: {
    todo: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
};

const POLL_INTERVAL_MS = 500;

test.describe.configure({ timeout: 90_000 });

function buildName(prefix: string) {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getTodayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function pollFor<T>(
  callback: () => Promise<T | null | undefined>,
  message: string,
  timeoutMs = 20_000
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await callback();
      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(message);
}

async function findVisible(page: Page, factories: Array<(page: Page) => Locator>, timeoutMs = 2_000) {
  for (const factory of factories) {
    const locator = factory(page).first();
    const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (visible) {
      return locator;
    }
  }

  throw new Error("Unable to find a visible locator from the provided candidates.");
}

async function fetchProjects(request: APIRequestContext) {
  const response = await request.get("/api/projects?includeTasks=true&limit=100");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return (payload.projects ?? []) as ApiProject[];
}

async function fetchTasks(request: APIRequestContext, projectId?: string) {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}&limit=100` : "?limit=100";
  const response = await request.get(`/api/tasks${suffix}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return (payload.tasks ?? []) as ApiTask[];
}

async function fetchCalendarEvents(request: APIRequestContext) {
  const response = await request.get("/api/calendar/events");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as CalendarEvent[];
}

async function fetchProjectDetails(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ApiProjectDetails;
}

async function fetchGantt(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/projects/${projectId}/gantt`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as GanttSnapshot;
  return payload.tasks ?? [];
}

async function fetchAnalyticsProject(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/analytics/overview?projectId=${encodeURIComponent(projectId)}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return ((payload.projects ?? []) as AnalyticsProject[]).find(
    (project) => project.projectId === projectId
  );
}

async function waitForExactText(page: Page, text: string, timeoutMs = 20_000) {
  await expect
    .poll(async () => page.getByText(text, { exact: true }).count(), {
      timeout: timeoutMs,
      message: `Expected to find text "${text}" in the UI.`,
    })
    .toBeGreaterThan(0);
}

test.describe("Integration - Project/Task Reflection", () => {
  test("creates a project and task via UI and reflects them across spaces", async ({
    page,
    request,
  }) => {
    const projectName = buildName("Launch Flow Project");
    const taskName = buildName("Launch Flow Task");
    const taskDueDate = getTodayIsoDate();

    await test.step("Create a project via the UI", async () => {
      await page.goto("/projects");
      await page.waitForLoadState("networkidle");

      const openProjectModal = await findVisible(page, [
        (currentPage) => currentPage.getByTestId("create-project-button"),
        (currentPage) =>
          currentPage.getByRole("button", {
            name: /add project|create project|добав.*проект|созд.*проект/i,
          }),
        (currentPage) =>
          currentPage.locator('button:has-text("Создать"), button:has-text("Добавить"), button:has-text("Add"), button:has-text("Create")'),
      ]);
      await openProjectModal.click();

      const projectDialog = await findVisible(page, [
        (currentPage) => currentPage.getByTestId("create-project-form"),
        (currentPage) => currentPage.getByRole("dialog"),
      ]);

      await projectDialog
        .locator('[data-testid="project-name-input"], input[id*="project-name"], input[name="name"]')
        .first()
        .fill(projectName);
      await projectDialog
        .locator('textarea[id*="project-description"], textarea')
        .first()
        .fill("Cross-space reflection regression coverage.");
      await projectDialog
        .locator('[data-testid="project-location-input"], input[id*="project-location"]')
        .first()
        .fill("Integration Bay");

      const submitProject = await findVisible(page, [
        () => projectDialog.getByTestId("submit-project-button"),
        () =>
          projectDialog.getByRole("button", {
            name: /add project|create project|добав.*проект|созд.*проект|save/i,
          }),
      ]);
      await submitProject.click();
    });

    const project = await pollFor(
      async () => (await fetchProjects(request)).find((candidate) => candidate.name === projectName),
      `Project "${projectName}" was not created.`
    );

    await test.step("Create a task for the new project via the UI", async () => {
      await page.goto(`/projects/${project.id}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();

      const openTaskModal = await findVisible(page, [
        (currentPage) => currentPage.getByTestId("create-task-button"),
        (currentPage) =>
          currentPage.getByRole("button", {
            name: /add task|create task|добав.*задач|созд.*задач/i,
          }),
        (currentPage) =>
          currentPage.locator('button:has-text("Задач"), button:has-text("Task")'),
      ]);
      await openTaskModal.click();

      const taskDialog = await findVisible(page, [
        (currentPage) => currentPage.getByTestId("create-task-form"),
        (currentPage) => currentPage.getByRole("dialog"),
      ]);

      await taskDialog
        .locator('[data-testid="task-title-input"], input[id*="task-title"], input[name="title"], input[name="name"]')
        .first()
        .fill(taskName);
      await taskDialog
        .locator('textarea[id*="task-description"], textarea')
        .first()
        .fill("Validates task propagation into every major surface.");
      await taskDialog
        .locator('[data-testid="task-due-date-input"], input[id*="task-due-date"], input[type="date"]')
        .first()
        .fill(taskDueDate);

      const submitTask = await findVisible(page, [
        () => taskDialog.getByTestId("submit-task-button"),
        () =>
          taskDialog.getByRole("button", {
            name: /add task|create task|добав.*задач|созд.*задач|save/i,
          }),
      ]);
      await submitTask.click();
    });

    const createdTask = await pollFor(
      async () =>
        (await fetchTasks(request, project.id)).find((candidate) => candidate.title === taskName),
      `Task "${taskName}" was not created.`
    );

    const milestoneName = buildName("Launch Flow Milestone");

    await test.step("Create a milestone through the API", async () => {
      const response = await request.post("/api/milestones", {
        data: {
          title: milestoneName,
          projectId: project.id,
          date: taskDueDate,
          status: "upcoming",
        },
      });
      expect(response.ok()).toBeTruthy();
    });

    const createdMilestone = await pollFor(
      async () =>
        (await fetchCalendarEvents(request)).find(
          (candidate) => candidate.title === milestoneName && candidate.kind === "milestone"
        ),
      `Milestone "${milestoneName}" was not reflected in calendar events.`
    );

    await test.step("Verify the new task reflects across project detail, tasks, calendar, gantt, and analytics", async () => {
      await page.goto(`/projects/${project.id}`);
      await page.waitForLoadState("networkidle");
      await waitForExactText(page, projectName);
      await waitForExactText(page, milestoneName);

      const browserTaskSnapshot = (await page.evaluate(async () => {
        const response = await fetch("/api/tasks?limit=100");
        return response.json();
      })) as { tasks?: Array<{ id: string; projectId?: string }> };
      const browserTask = (browserTaskSnapshot.tasks ?? []).find((task) => task.id === createdTask.id);
      expect(browserTask?.projectId).toBe(project.id);
      expect(browserTaskSnapshot.tasks ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: createdTask.id, projectId: project.id }),
        ])
      );

      await page.getByRole("tab", { name: /tasks|задач/i }).click();
      const createdTaskCard = page.locator(
        `[data-testid="project-task-card"][data-task-id="${createdTask.id}"]`
      );
      await expect(createdTaskCard).toBeVisible({ timeout: 20_000 });
      await expect(createdTaskCard).toContainText(taskName);

      await page.goto("/tasks");
      await page.waitForLoadState("networkidle");
      const createdTaskRow = page.locator(
        `[data-testid="task-row"][data-task-id="${createdTask.id}"]`
      );
      await expect(createdTaskRow).toBeVisible();
      await expect(createdTaskRow).toContainText(taskName);

      await page.goto("/calendar", { waitUntil: "domcontentloaded" });
      const calendarEventCard = page.locator(
        `[data-testid="calendar-event-card"][data-event-id="${createdTask.id}"]`
      );
      await expect(calendarEventCard).toBeVisible();
      await expect(calendarEventCard).toContainText(taskName);

      await page.goto(`/projects/${project.id}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("tab", { name: /gantt|гант/i }).click();
      const ganttTaskItem = page.locator(
        `[data-testid="gantt-task-item"][data-task-id="${createdTask.id}"]`
      );
      await expect(ganttTaskItem).toBeVisible();
      await expect(ganttTaskItem).toContainText(taskName);

      await page.goto("/analytics", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /аналитик|analytics/i }).first()).toBeVisible({
        timeout: 20_000,
      });

      const calendarEvent = await pollFor(
        async () => (await fetchCalendarEvents(request)).find((event) => event.id === createdTask.id),
        `Calendar event for task "${taskName}" was not found.`
      );
      expect(calendarEvent.title).toBe(taskName);
      expect(calendarEvent.resource.projectId).toBe(project.id);

      const projectDetails = await pollFor(
        async () => fetchProjectDetails(request, project.id),
        `Project "${projectName}" did not return hydrated milestones.`
      );
      expect(projectDetails.milestones ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: createdMilestone.id,
            title: milestoneName,
            projectId: project.id,
          }),
        ])
      );

      const ganttTask = await pollFor(
        async () => (await fetchGantt(request, project.id)).find((item) => item.id === createdTask.id),
        `Gantt entry for task "${taskName}" was not found.`
      );
      expect(ganttTask.name).toBe(taskName);
      expect(ganttTask.projectId).toBe(project.id);

      const analyticsProject = await pollFor(
        async () => fetchAnalyticsProject(request, project.id),
        `Analytics summary for project "${projectName}" was not found.`
      );
      expect(analyticsProject.projectName).toBe(projectName);
      expect(analyticsProject.totalTasks).toBeGreaterThanOrEqual(1);
      expect(analyticsProject.statusBreakdown.todo).toBeGreaterThanOrEqual(1);
    });

    await test.step("Mark the task done and verify the downstream status changes", async () => {
      const updateResponse = await request.put(`/api/tasks/${createdTask.id}`, {
        data: {
          status: "done",
        },
      });
      expect(updateResponse.ok()).toBeTruthy();

      const completedTask = await pollFor(
        async () => {
          const task = (await fetchTasks(request, project.id)).find((candidate) => candidate.id === createdTask.id);
          return task?.status === "done" ? task : null;
        },
        `Task "${taskName}" did not reach done.`
      );
      expect(completedTask.projectId).toBe(project.id);

      const completedCalendarEvent = await pollFor(
        async () => {
          const event = (await fetchCalendarEvents(request)).find((candidate) => candidate.id === createdTask.id);
          return event?.status === "done" ? event : null;
        },
        `Calendar did not reflect done status for "${taskName}".`
      );
      expect(completedCalendarEvent.title).toBe(taskName);

      const completedGanttTask = await pollFor(
        async () => {
          const item = (await fetchGantt(request, project.id)).find((candidate) => candidate.id === createdTask.id);
          return item?.type === "done" ? item : null;
        },
        `Gantt did not reflect done status for "${taskName}".`
      );
      expect(completedGanttTask.progress).toBe(100);

      const completedAnalyticsProject = await pollFor(
        async () => {
          const analyticsProject = await fetchAnalyticsProject(request, project.id);
          return analyticsProject && analyticsProject.statusBreakdown.done >= 1
            ? analyticsProject
            : null;
        },
        `Analytics did not reflect done status for "${taskName}".`
      );
      expect(completedAnalyticsProject.statusBreakdown.done).toBeGreaterThanOrEqual(1);

      await page.goto("/tasks");
      await page.waitForLoadState("networkidle");
      const completedTaskRow = page.locator(
        `[data-testid="task-row"][data-task-id="${createdTask.id}"]`
      );
      await expect(completedTaskRow).toBeVisible();
      await expect(completedTaskRow).toContainText(/done|выполнено|completed/i);

      await page.goto("/calendar", { waitUntil: "domcontentloaded" });
      const completedCalendarEventCard = page.locator(
        `[data-testid="calendar-event-card"][data-event-id="${createdTask.id}"]`
      );
      await expect(completedCalendarEventCard).toBeVisible();
      await expect(completedCalendarEventCard).toContainText(taskName);

      const milestoneCalendarEventCard = page.locator(
        `[data-testid="calendar-event-card"][data-event-id="${createdMilestone.id}"]`
      );
      await expect(milestoneCalendarEventCard).toBeVisible();
      await expect(milestoneCalendarEventCard).toContainText(milestoneName);

      await page.goto(`/projects/${project.id}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("tab", { name: /gantt|гант/i }).click();
      const completedGanttTaskItem = page.locator(
        `[data-testid="gantt-task-item"][data-task-id="${createdTask.id}"]`
      );
      await expect(completedGanttTaskItem).toBeVisible();
      await expect(completedGanttTaskItem).toContainText(taskName);
    });
  });
});
