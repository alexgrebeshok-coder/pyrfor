/** OpenTelemetry GenAI semantic convention attribute keys used by the engine. */
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
export const GEN_AI_USAGE_COST = 'gen_ai.usage.cost';
export const GEN_AI_AGENT_STEP = 'gen_ai.agent.step';
export const GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
export function genAiLifecycleAttrs(step) {
    return {
        [GEN_AI_OPERATION_NAME]: 'agent_step',
        [GEN_AI_AGENT_STEP]: step,
    };
}
