export const STAGE1_DEMO_PROJECT_NAME = "Строительство распределительного центра «Восток»";
export const STAGE1_DEMO_REPORT_NUMBER = "#202603190002";

type Stage1DemoReportLike = {
  id: string;
  reportNumber: string;
  projectId: string;
  status: string;
  project: {
    name: string;
  };
};

export function pickStage1DemoReport<T extends Stage1DemoReportLike>(reports: T[]): T | null {
  if (reports.length === 0) {
    return null;
  }

  return (
    reports.find(
      (report) =>
        report.project.name === STAGE1_DEMO_PROJECT_NAME && report.status === "submitted"
    ) ??
    reports.find((report) => report.reportNumber === STAGE1_DEMO_REPORT_NUMBER) ??
    reports.find((report) => report.status === "submitted") ??
    reports[0] ??
    null
  );
}

export function buildStage1DemoLinks(
  report: Pick<Stage1DemoReportLike, "id" | "projectId" | "project" | "reportNumber">
) {
  const portfolioParams = new URLSearchParams({
    query: report.project.name,
  });
  const workReportsParams = new URLSearchParams({
    demo: "stage1",
    reportId: report.id,
    query: report.reportNumber,
  });
  const tasksParams = new URLSearchParams({
    demo: "stage1",
    projectId: report.projectId,
  });

  return {
    portfolioHref: `/projects?${portfolioParams.toString()}`,
    workReportsHref: `/work-reports?${workReportsParams.toString()}#stage1-action-pilot`,
    tasksHref: `/tasks?${tasksParams.toString()}`,
  };
}

export function isRegistrationFreeDemo(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.CEOCLAW_SKIP_AUTH === "true";
}

export function isDeterministicDemoAI(env: NodeJS.ProcessEnv = process.env) {
  return env.SEOCLAW_AI_MODE === "mock";
}
