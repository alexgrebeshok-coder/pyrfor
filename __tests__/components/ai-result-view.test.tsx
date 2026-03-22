import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AIResultView } from "@/components/ai/ai-result-view";

const mockUseAIWorkspace = vi.fn();
const mockUseLocale = vi.fn();
const mockUseSWR = vi.fn();

vi.mock("@/contexts/ai-context", () => ({
  useAIWorkspace: () => mockUseAIWorkspace(),
}));

vi.mock("@/contexts/locale-context", () => ({
  useLocale: () => mockUseLocale(),
}));

vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

describe("AIResultView", () => {
  beforeEach(() => {
    mockUseLocale.mockReturnValue({
      locale: "ru",
      t: (key: string) => key,
    });

    mockUseAIWorkspace.mockReturnValue({
      selectedRun: {
        id: "ai-run-council",
        agentId: "execution-planner",
        title: "Council synthesis",
        prompt: "Plan the next execution steps",
        quickActionId: null,
        status: "done",
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:05:00.000Z",
        context: {
          subtitle: "Project execution",
          title: "Arctic Road",
          type: "project",
          pathname: "/projects/project-arctic-road",
        },
        result: {
          title: "Council synthesis",
          summary: "The council aligned on a practical plan.",
          highlights: ["Sequence the remaining work", "Treat permit as blocker"],
          nextSteps: ["Confirm owner", "Review dependencies"],
          proposal: null,
          actionResult: null,
          collaboration: {
            mode: "collaborative",
            leaderAgentId: "execution-planner",
            leaderRuntime: {
              provider: "openrouter",
              model: "google/gemma-3-27b-it:free",
            },
            supportAgentIds: ["risk-researcher", "quality-guardian"],
            reason:
              "Execution planning is stronger when risk and quality are validated in parallel.",
            consensus: ["Sequence the remaining work", "Treat permit as blocker"],
            steps: [
              {
                agentId: "risk-researcher",
                agentName: "Risk Researcher",
                role: "Risk Researcher",
                focus: "Surface delivery risks before finalizing the plan.",
                status: "done",
                runtime: {
                  provider: "openrouter",
                  model: "google/gemma-3-12b-it:free",
                },
                title: "Risk lens",
                summary: "Permit and logistics are the main blockers.",
                highlights: ["Treat the permit as the top blocker."],
                nextSteps: ["Escalate the permit path."],
                proposalType: null,
              },
              {
                agentId: "quality-guardian",
                agentName: "Quality Guardian",
                role: "Quality Guardian",
                focus: "Check the plan for realism and acceptance quality.",
                status: "done",
                runtime: {
                  provider: "openrouter",
                  model: "google/gemma-3-12b-it:free",
                },
                title: "Quality lens",
                summary: "The plan needs a clearer acceptance gate.",
                highlights: ["Define a crisp completion gate."],
                nextSteps: ["Add a final review step."],
                proposalType: null,
              },
              {
                agentId: "execution-planner",
                agentName: "Execution Planner",
                role: "Execution Planner",
                focus: "Synthesize the council into an executable answer.",
                status: "done",
                runtime: {
                  provider: "openrouter",
                  model: "google/gemma-3-27b-it:free",
                },
                title: "Council synthesis",
                summary: "The council aligned on the next actions.",
                highlights: ["Sequence the remaining work."],
                nextSteps: ["Confirm owner."],
                proposalType: null,
              },
            ],
          },
        },
      },
      quickActions: [],
      runQuickAction: vi.fn(),
    });

    mockUseSWR.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      mutate: vi.fn(),
    });
  });

  it("renders the multi-agent council summary in the AI result view", () => {
    render(<AIResultView />);

    expect(screen.getByText(/Multi-agent council/i)).toBeInTheDocument();
    expect(screen.getByText(/Leader: Execution Planner/i)).toBeInTheDocument();
    expect(screen.getAllByText("Risk Researcher").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quality Guardian").length).toBeGreaterThan(0);
    expect(screen.getByText(/Council consensus/i)).toBeInTheDocument();
    expect(screen.getAllByText("Sequence the remaining work").length).toBeGreaterThan(0);
  });
});
