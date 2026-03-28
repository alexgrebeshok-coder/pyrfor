import assert from "node:assert/strict";

import { parseToolCallsFromResponse, runAgentExecution } from "@/lib/ai/agent-executor";

async function testParsesToolCallsAcrossFormats() {
  const markdown = '```tool_calls\n[{"id":"1","function":{"name":"get_project_summary","arguments":"{}"}}]\n```';
  const embedded = 'Result:\n[{"id":"2","function":{"name":"list_tasks","arguments":"{\\"limit\\":5}"}}]';
  const direct = '[{"id":"3","function":{"name":"generate_brief","arguments":"{}"}}]';

  assert.equal(parseToolCallsFromResponse(markdown).length, 1);
  assert.equal(parseToolCallsFromResponse(embedded).length, 1);
  assert.equal(parseToolCallsFromResponse(direct).length, 1);
  assert.equal(parseToolCallsFromResponse("not json").length, 0);
}

async function testUsesInjectedRouter() {
  const prompts: string[] = [];
  const fakeRouter = {
    getAvailableProviders: () => ["openrouter"],
    chat: async (messages: Array<{ role: string; content: string }>) => {
      prompts.push(messages.map((message) => message.content).join("\n"));
      return "final answer";
    },
  };

  const result = await runAgentExecution(
    [{ role: "user", content: "hello executor" }],
    {
      agentId: "status-reporter",
      runId: "run-executor-test",
      router: fakeRouter as never,
      enableTools: false,
    }
  );

  assert.equal(result.finalContent, "final answer");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /hello executor/);
}

async function run() {
  await testParsesToolCallsAcrossFormats();
  await testUsesInjectedRouter();
  console.log("PASS agent-executor.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
