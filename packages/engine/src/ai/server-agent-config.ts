import "server-only";

import { getAgentById } from "@/lib/ai/agents";
import { getEnrichedAgent } from "@/lib/ai/agent-loader";

export async function getEnrichedAgentById(agentId: string) {
  const base = getAgentById(agentId);
  if (!base) return null;

  return getEnrichedAgent(base);
}
