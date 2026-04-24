"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnrichedAgentById = getEnrichedAgentById;
require("server-only");
const agents_1 = require("./agents");
const agent_loader_1 = require("./agent-loader");
async function getEnrichedAgentById(agentId) {
    const base = (0, agents_1.getAgentById)(agentId);
    if (!base)
        return null;
    return (0, agent_loader_1.getEnrichedAgent)(base);
}
