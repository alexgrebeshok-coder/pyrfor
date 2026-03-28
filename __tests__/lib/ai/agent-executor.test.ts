import { describe, expect, it } from "vitest";

import { parseToolCallsFromResponse, runAgentExecution } from "@/lib/ai/agent-executor";

describe("agent-executor", () => {
  it("parses tool calls from markdown, embedded arrays, and direct JSON", () => {
    expect(
      parseToolCallsFromResponse(
        '```tool_calls\n[{"id":"1","function":{"name":"get_project_summary","arguments":"{}"}}]\n```'
      )
    ).toHaveLength(1);
    expect(
      parseToolCallsFromResponse(
        'Response:\n[{"id":"2","function":{"name":"list_tasks","arguments":"{\\"limit\\":5}"}}]'
      )
    ).toHaveLength(1);
    expect(
      parseToolCallsFromResponse(
        '[{"id":"3","function":{"name":"generate_brief","arguments":"{}"}}]'
      )
    ).toHaveLength(1);
    expect(parseToolCallsFromResponse("not-a-tool-call")).toHaveLength(0);
  });

  it("uses the injected router for execution", async () => {
    const fakeRouter = {
      getAvailableProviders: () => ["openrouter"],
      chat: async () => "executor result",
    };

    const result = await runAgentExecution(
      [{ role: "user", content: "hello" }],
      {
        agentId: "status-reporter",
        runId: "executor-vitest",
        router: fakeRouter as never,
        enableTools: false,
      }
    );

    expect(result.finalContent).toBe("executor result");
    expect(result.rounds).toBe(1);
  });
});
