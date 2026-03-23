import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, FileText, ListTodo, Rocket, Sparkles } from "lucide-react";

import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getEvidenceLedgerOverview } from "@/lib/evidence";
import { buildStage1DemoLinks, isDeterministicDemoAI, isRegistrationFreeDemo, pickStage1DemoReport } from "@/lib/demo/stage1";
import { prisma } from "@/lib/prisma";
import { canReadLiveOperatorData, getServerRuntimeState } from "@/lib/server/runtime-mode";
import { cn } from "@/lib/utils";
import { listWorkReports } from "@/lib/work-reports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Stage 1 demo | CEOClaw",
  description: "Guided Stage 1 walkthrough for the seeded work-report → evidence → action flow.",
  alternates: {
    canonical: "/demo/stage1",
  },
  openGraph: {
    title: "Stage 1 demo | CEOClaw",
    description: "Guided Stage 1 walkthrough for the seeded work-report → evidence → action flow.",
    url: "/demo/stage1",
    siteName: "CEOClaw",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CEOClaw guided Stage 1 demo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stage 1 demo | CEOClaw",
    description: "Guided Stage 1 walkthrough for the seeded work-report → evidence → action flow.",
    images: ["/opengraph-image"],
  },
};

type DemoStep = {
  id: number;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: typeof BriefcaseBusiness;
};

function StepCard({ step }: { step: DemoStep }) {
  const Icon = step.icon;

  return (
    <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--panel-soft)] text-[var(--brand)]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Step {step.id}
            </div>
            <CardTitle className="text-base">{step.title}</CardTitle>
            <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
              {step.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Link className={cn(buttonVariants({ size: "sm", variant: "outline" }), "w-full")} href={step.href}>
          {step.cta}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

function StatsCard({
  title,
  value,
  description,
  tone = "neutral",
}: {
  title: string;
  value: string;
  description: string;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">{title}</p>
        <Badge variant={tone}>{tone}</Badge>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">{value}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
    </div>
  );
}

export default async function Stage1DemoPage() {
  const runtimeState = getServerRuntimeState();
  const liveWorkflowReady = canReadLiveOperatorData(runtimeState);
  const registrationFreeDemo = isRegistrationFreeDemo();
  const deterministicDemoAi = isDeterministicDemoAI();

  if (!liveWorkflowReady) {
    return (
      <div className="grid gap-4">
        <DomainPageHeader
          actions={
            <Link className={buttonVariants({ variant: "outline" })} href="/work-reports">
              Open work reports
            </Link>
          }
          chips={[
            { label: "Guided Stage 1", variant: "info" },
            { label: "Live DB required", variant: "warning" },
            {
              label: registrationFreeDemo ? "No sign-in demo active" : "Sign-in depends on env",
              variant: registrationFreeDemo ? "success" : "warning",
            },
          ]}
          description="This route guides a seeded local walkthrough, but it needs a live development database. Start the app with SQLite + demo seed to unlock the full Stage 1 path."
          eyebrow="Guided onboarding"
          title="Stage 1 demo"
        />

        <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>How to enable the local demo</CardTitle>
            <CardDescription>
              Run the verified Stage 1 setup, then reopen this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-[var(--ink-soft)]">
            <pre className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-xs leading-6 text-[var(--ink)]">{`npm install
npm run db:sqlite && npx prisma db push && npm run seed:demo
CEOCLAW_SKIP_AUTH=true SEOCLAW_AI_MODE=mock npm run dev`}</pre>
            <p>
              The guided route becomes most predictable when <code>SEOCLAW_AI_MODE=mock</code> is enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const reports = await listWorkReports({ limit: 20 });
  const report = pickStage1DemoReport(reports);

  if (!report) {
    return (
      <div className="grid gap-4">
        <DomainPageHeader
          actions={
            <Link className={buttonVariants({ variant: "outline" })} href="/work-reports">
              Open work reports
            </Link>
          }
          chips={[
            { label: "Guided Stage 1", variant: "info" },
            { label: "Seed data missing", variant: "warning" },
            {
              label: deterministicDemoAi ? "Mock AI active" : "Live AI mode",
              variant: deterministicDemoAi ? "success" : "warning",
            },
          ]}
          description="The demo route is ready, but no suitable work report was found in the current database."
          eyebrow="Guided onboarding"
          title="Stage 1 demo"
        />

        <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Seed the demo dataset</CardTitle>
            <CardDescription>
              Use the built-in seed to load the construction scenario that powers the 5-step walkthrough.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-[var(--ink-soft)]">
            <pre className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-xs leading-6 text-[var(--ink)]">{`npm run db:sqlite
npx prisma db push
npm run seed:demo`}</pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [evidenceOverview, taskCount, riskCount] = await Promise.all([
    getEvidenceLedgerOverview({
      entityType: "work_report",
      entityRef: report.id,
      limit: 10,
    }),
    prisma.task.count({
      where: {
        projectId: report.projectId,
      },
    }),
    prisma.risk.count({
      where: {
        projectId: report.projectId,
      },
    }),
  ]);

  const links = buildStage1DemoLinks(report);
  const steps: DemoStep[] = [
    {
      id: 1,
      title: "Portfolio context",
      description: `Open the project portfolio filtered to ${report.project.name} and confirm that this is the scenario you will walk through.`,
      href: links.portfolioHref,
      cta: "Open portfolio step",
      icon: BriefcaseBusiness,
    },
    {
      id: 2,
      title: "Deviation and field fact",
      description: `Jump into report ${report.reportNumber}, read the blocker, and confirm the field report is the source fact for the next action.`,
      href: links.workReportsHref,
      cta: "Open deviation step",
      icon: FileText,
    },
    {
      id: 3,
      title: "Recommendation",
      description: "Inside Work Reports, click `Собрать signal packet` to generate the tasks, risks, and status runs for the selected report.",
      href: links.workReportsHref,
      cta: "Open recommendation step",
      icon: Sparkles,
    },
    {
      id: 4,
      title: "Approval",
      description: "Review the generated `create_tasks` proposal and apply it manually. This is the current human approval gate in Stage 1.",
      href: links.workReportsHref,
      cta: "Open approval step",
      icon: CheckCircle2,
    },
    {
      id: 5,
      title: "Result",
      description: "Open the tasks page filtered to the demo project and confirm that the new recovery tasks are now in the live backlog.",
      href: links.tasksHref,
      cta: "Open result step",
      icon: ListTodo,
    },
  ];

  return (
    <div className="grid gap-4">
      <DomainPageHeader
        actions={
          <Link className={buttonVariants()} href={links.workReportsHref}>
            Start the 5-step demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        }
        chips={[
          { label: "Guided Stage 1", variant: "info" },
          {
            label: registrationFreeDemo ? "No sign-in demo active" : "Sign-in depends on env",
            variant: registrationFreeDemo ? "success" : "warning",
          },
          {
            label: deterministicDemoAi ? "Mock AI active" : "Live AI mode",
            variant: deterministicDemoAi ? "success" : "warning",
          },
          {
            label:
              evidenceOverview.records.length > 0
                ? `${evidenceOverview.records.length} evidence record`
                : "Evidence pending",
            variant: evidenceOverview.records.length > 0 ? "success" : "warning",
          },
        ]}
        description="A 5-minute walkthrough for the verified Stage 1 slice: portfolio -> deviation -> recommendation -> approval -> result. It is optimized for the seeded construction scenario and local demo mode."
        eyebrow="Guided onboarding"
        title="Stage 1 demo"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Five-step guided flow</CardTitle>
            <CardDescription>
              The route keeps the older guided walkthrough from the historical branch, but uses the current live data services and the current work-reports surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {steps.map((step) => (
              <StepCard key={step.id} step={step} />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-[var(--brand)]" />
                <CardTitle className="text-2xl tracking-[-0.06em]">Selected report</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                {report.reportNumber} · {report.project.name} · {report.section}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StatsCard
                description="This report is the starting fact for the guided flow."
                title="Report status"
                tone={report.status === "submitted" ? "warning" : report.status === "approved" ? "success" : "info"}
                value={report.status}
              />
              <StatsCard
                description="How many tasks already live in the demo project."
                title="Tasks"
                value={String(taskCount)}
              />
              <StatsCard
                description="How many risks are already tracked for the same project."
                title="Risks"
                value={String(riskCount)}
                tone={riskCount > 0 ? "warning" : "success"}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader>
              <CardTitle>Evidence ledger</CardTitle>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                The current report already has supporting evidence. That is why the guided flow starts with a real field fact instead of a placeholder.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <StatsCard
                description="Facts synced from the work report evidence model."
                title="Evidence records"
                tone={evidenceOverview.records.length > 0 ? "success" : "warning"}
                value={String(evidenceOverview.records.length)}
              />
              <StatsCard
                description={`The latest synced snapshot: ${evidenceOverview.syncedAt ?? "not available"}.`}
                title="Last sync"
                value={evidenceOverview.syncedAt ? "Available" : "Pending"}
                tone={evidenceOverview.syncedAt ? "success" : "warning"}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader>
              <CardTitle>Next action</CardTitle>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                Continue either to the guided work report page or back to the public demo chat.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ size: "sm" }), "bg-white text-slate-950 hover:bg-slate-100")} href={links.workReportsHref}>
                Open guided work reports
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/demo">
                Back to public demo
              </Link>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader>
              <CardTitle>Evidence snapshot</CardTitle>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                The first few evidence items that support the next recommendation.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {evidenceOverview.records.slice(0, 3).map((record) => (
                <div
                  className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  key={record.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={record.verificationStatus === "verified" ? "success" : "info"}>
                      {record.verificationStatus}
                    </Badge>
                    <span className="text-sm font-medium text-[var(--ink)]">{record.title}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{record.summary}</p>
                </div>
              ))}
              {evidenceOverview.records.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--ink-soft)]">Evidence is still syncing for this report.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
