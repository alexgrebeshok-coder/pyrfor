import "server-only";

import { getAgentById } from './agents';
import { getEnrichedAgent } from './agent-loader';

export async function getEnrichedAgentById(agentId: string) {
  const base = getAgentById(agentId);
  if (!base) return null;

  return getEnrichedAgent(base);
}
