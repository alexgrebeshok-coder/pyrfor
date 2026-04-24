/**
 * Dynamic Collaboration Planner
 *
 * Replaces the 5 hardcoded collaboration blueprints in multi-agent-runtime.ts
 * with a config-driven, LLM-assisted planning layer.
 *
 * Planning modes:
 * 1. config  — reads from config/agents/<agentId>.json collaboration block (fast)
 * 2. heuristic — applies domain rules based on agent category + context signals (fast)
 * 3. llm    — asks the LLM to plan the collaboration (slow, best quality)
 *
 * The default is "heuristic" with fallback to "config" entries for known agents.
 */
import { z } from "zod";
import type { AIRunInput } from '../types';
export declare const CollaborationStepSchema: z.ZodObject<{
    agentId: z.ZodString;
    focus: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        reviewer: "reviewer";
        support: "support";
        synthesizer: "synthesizer";
    }>>;
}, z.core.$strip>;
export declare const CollaborationPlanSchema: z.ZodObject<{
    collaborative: z.ZodBoolean;
    leaderAgentId: z.ZodString;
    reason: z.ZodString;
    steps: z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        focus: z.ZodString;
        role: z.ZodDefault<z.ZodEnum<{
            reviewer: "reviewer";
            support: "support";
            synthesizer: "synthesizer";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CollaborationStep = z.infer<typeof CollaborationStepSchema>;
export type CollaborationPlan = z.infer<typeof CollaborationPlanSchema>;
export declare function buildDynamicPlan(input: AIRunInput): CollaborationPlan;
/**
 * Check whether a collaborative run should be used.
 * Drop-in replacement for shouldUseCollaborativeRun().
 */
export declare function shouldCollaborate(input: AIRunInput): boolean;
//# sourceMappingURL=planner.d.ts.map