import type { CreateAgentInput, UpdateAgentInput, AgentWithState, AgentStatus } from "./types";
export declare function syncAgentDefinitions(workspaceId: string): Promise<{
    created: number;
}>;
export declare function listAgents(workspaceId: string, opts?: {
    status?: AgentStatus;
    includeState?: boolean;
}): Promise<AgentWithState[]>;
export declare function getAgent(id: string): Promise<AgentWithState | null>;
export declare function createAgent(input: CreateAgentInput): Promise<{
    runtimeState: {
        id: string;
        updatedAt: Date;
        lastError: string | null;
        agentId: string;
        totalTokens: number;
        totalCostCents: number;
        totalRuns: number;
        successfulRuns: number;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt: Date | null;
        circuitOpenUntil: Date | null;
        lastRunId: string | null;
        lastHeartbeatAt: Date | null;
    } | null;
} & {
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
export declare function updateAgent(id: string, input: UpdateAgentInput, changedBy?: string): Promise<{
    runtimeState: {
        id: string;
        updatedAt: Date;
        lastError: string | null;
        agentId: string;
        totalTokens: number;
        totalCostCents: number;
        totalRuns: number;
        successfulRuns: number;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt: Date | null;
        circuitOpenUntil: Date | null;
        lastRunId: string | null;
        lastHeartbeatAt: Date | null;
    } | null;
} & {
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
export declare function deleteAgent(id: string): Promise<{
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
export declare function getOrgChart(workspaceId: string): Promise<({
    name: string;
    id: string;
    status: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
} & {
    children: ({
        name: string;
        id: string;
        status: string;
        role: string;
        slug: string;
        definitionId: string | null;
        reportsToId: string | null;
        budgetMonthlyCents: number;
        spentMonthlyCents: number;
    } & /*elided*/ any)[];
})[]>;
export declare function createApiKey(agentId: string, name: string): Promise<{
    id: string;
    name: string;
    keyPrefix: string;
    plainKey: string;
}>;
export declare function revokeApiKey(keyId: string): Promise<{
    name: string;
    id: string;
    createdAt: Date;
    agentId: string;
    keyHash: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
}>;
export declare function listApiKeys(agentId: string): Promise<{
    name: string;
    id: string;
    createdAt: Date;
    keyPrefix: string;
    lastUsedAt: Date | null;
}[]>;
export declare function resolveAgentByApiKey(plainKey: string): Promise<{
    agentId: string;
    workspaceId: string;
    definitionId: string | null;
} | null>;
export declare function pauseAgent(id: string): Promise<{
    runtimeState: {
        id: string;
        updatedAt: Date;
        lastError: string | null;
        agentId: string;
        totalTokens: number;
        totalCostCents: number;
        totalRuns: number;
        successfulRuns: number;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt: Date | null;
        circuitOpenUntil: Date | null;
        lastRunId: string | null;
        lastHeartbeatAt: Date | null;
    } | null;
} & {
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
export declare function resumeAgent(id: string): Promise<{
    runtimeState: {
        id: string;
        updatedAt: Date;
        lastError: string | null;
        agentId: string;
        totalTokens: number;
        totalCostCents: number;
        totalRuns: number;
        successfulRuns: number;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt: Date | null;
        circuitOpenUntil: Date | null;
        lastRunId: string | null;
        lastHeartbeatAt: Date | null;
    } | null;
} & {
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
export declare function terminateAgent(id: string): Promise<{
    runtimeState: {
        id: string;
        updatedAt: Date;
        lastError: string | null;
        agentId: string;
        totalTokens: number;
        totalCostCents: number;
        totalRuns: number;
        successfulRuns: number;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt: Date | null;
        circuitOpenUntil: Date | null;
        lastRunId: string | null;
        lastHeartbeatAt: Date | null;
    } | null;
} & {
    name: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    workspaceId: string;
    role: string;
    slug: string;
    definitionId: string | null;
    reportsToId: string | null;
    adapterType: string;
    adapterConfig: string;
    runtimeConfig: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
    permissions: string;
}>;
//# sourceMappingURL=agent-service.d.ts.map