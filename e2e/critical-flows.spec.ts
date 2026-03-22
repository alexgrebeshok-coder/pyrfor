import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

test.describe("Critical Flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test("Homepage loads successfully", async ({ page }) => {
    await expect(page).toHaveTitle(/CEOClaw|Dashboard/);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("Navigation works", async ({ page }) => {
    // Check sidebar navigation
    const projectsLink = page.getByRole("link", { name: /проекты/i }).first();
    await expect(projectsLink).toBeVisible();
    
    await projectsLink.click();
    await expect(page).toHaveURL(/.*projects/);
  });

  test("Projects page displays projects", async ({ page }) => {
    await page.goto(`${BASE_URL}/projects`);
    
    // Wait for projects to load
    await page.waitForSelector('[data-testid="projects-page"]', {
      timeout: 5000,
    });
    
    await expect(page.getByTestId("projects-page")).toBeVisible();
    await expect(page.getByTestId("projects-page")).toContainText(/проект/i);
  });

  test("Kanban board loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/kanban`);
    
    // Wait for board to load
    await page.waitForSelector('[data-testid="kanban-board"]', {
      timeout: 10000,
    });
    
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page).toHaveURL(/.*kanban/);
  });

  test("Analytics page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/analytics`);
    
    await expect(page.getByTestId("analytics-page")).toBeVisible();
    await expect(page.getByTestId("analytics-page")).toContainText(/аналитик|analytics/i);
  });

  test("Calendar page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/calendar`);
    
    await expect(page.getByTestId("calendar-page")).toBeVisible();
    await expect(page.getByTestId("calendar-page")).toContainText(/календарь|calendar/i);
  });
});

test.describe("API Health Checks", () => {
  test("Health API returns OK", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(["healthy", "degraded"]).toContain(data.status);
  });

  test("Projects API returns data", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/projects`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(Array.isArray(data.projects)).toBeTruthy();
    expect(data.projects.length).toBeGreaterThan(0);
  });

  test("Notifications API returns data", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/notifications?userId=default`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty("notifications");
    expect(data).toHaveProperty("unreadCount");
  });
});

test.describe("Accessibility", () => {
  test("Page has proper heading structure", async ({ page }) => {
    await page.goto(BASE_URL);
    
    const h1 = page.locator("h1");
    await expect(h1).toBeVisible();
  });

  test("Interactive elements are keyboard accessible", async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Tab through first few interactive elements
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    
    // Check that focus is visible
    const focusedElement = page.locator(":focus");
    await expect(focusedElement).toBeVisible();
  });
});
