import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasOpenClawGateway: vi.fn(),
  getServerAIStatus: vi.fn(),
  invokeOpenClawGateway: vi.fn(),
  resolveAgentId: vi.fn(),
  getAgentById: vi.fn(),
}));

vi.mock("@/lib/ai/server-runs", () => ({
  hasOpenClawGateway: mocks.hasOpenClawGateway,
  getServerAIStatus: mocks.getServerAIStatus,
}));

vi.mock("@/lib/ai/openclaw-gateway", () => ({
  invokeOpenClawGateway: mocks.invokeOpenClawGateway,
}));

vi.mock("@/lib/ai/auto-routing", () => ({
  resolveAgentId: mocks.resolveAgentId,
}));

vi.mock("@/lib/ai/agents", () => ({
  AUTO_AGENT_ID: "auto",
  getAgentById: mocks.getAgentById,
}));

import { GET, POST } from "@/app/api/ai/local/route";

describe("AI local route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOpenClawGateway.mockReturnValue(true);
    mocks.getServerAIStatus.mockReturnValue({
      mode: "gateway",
      gatewayKind: "local",
      gatewayAvailable: true,
      providerAvailable: false,
      isProduction: false,
      unavailableReason: null,
    });
    mocks.resolveAgentId.mockReturnValue("portfolio-analyst");
    mocks.getAgentById.mockReturnValue({
      id: "portfolio-analyst",
      kind: "analyst",
      nameKey: "ai.agent.portfolioAnalyst",
      accentClass: "bg-white",
      icon: "🤖",
      category: "strategic",
      recommended: true,
    });
    mocks.invokeOpenClawGateway.mockResolvedValue({
      title: "Local gateway run",
      summary: "Gateway response",
      highlights: ["Gateway is connected."],
      nextSteps: ["Continue testing."],
      proposal: null,
    });
  });

  it("reports gateway status in GET", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      configured: boolean;
      aiStatus: { mode: string; gatewayAvailable: boolean };
    };

    expect(body.success).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.aiStatus.mode).toBe("gateway");
    expect(body.aiStatus.gatewayAvailable).toBe(true);
  });

  it("runs a local gateway prompt when configured", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/local", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Проверь локальный gateway",
        }),
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      runId: string;
      response: string;
      result: { summary: string };
    };

    expect(body.success).toBe(true);
    expect(body.runId).toContain("local-ai-");
    expect(body.response).toBe("Gateway response");
    expect(body.result.summary).toBe("Gateway response");
    expect(mocks.invokeOpenClawGateway).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the gateway is missing", async () => {
    mocks.hasOpenClawGateway.mockReturnValue(false);
    mocks.getServerAIStatus.mockReturnValue({
      mode: "mock",
      gatewayKind: "missing",
      gatewayAvailable: false,
      providerAvailable: false,
      isProduction: false,
      unavailableReason: null,
    });

    const response = await POST(
      new Request("http://localhost/api/ai/local", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Проверь локальный gateway",
        }),
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { success: boolean; code: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("LOCAL_GATEWAY_DISABLED");
  });
});
