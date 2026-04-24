"use strict";
/**
 * Agent Self-Reflection Loop
 *
 * Implements a Reflexion-style self-evaluation pattern:
 * 1. Agent produces initial response
 * 2. Reflection evaluator scores the response on quality criteria
 * 3. If score < threshold, agent is asked to revise
 * 4. Up to MAX_REFLECTION_ROUNDS revisions
 *
 * Quality criteria:
 * - Completeness: Did the agent answer all parts of the request?
 * - Specificity: Are recommendations concrete with numbers/names/dates?
 * - Actionability: Can the user act on the output immediately?
 * - Consistency: Does the output contradict the context?
 *
 * When to use:
 * - High-stakes reports (status reports, budget analysis)
 * - Multi-part complex requests
 * - When collaborative mode is not triggered
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReflectionScore = parseReflectionScore;
exports.runWithReflection = runWithReflection;
exports.shouldReflect = shouldReflect;
const providers_1 = require("../providers");
const logger_1 = require("../../observability/logger");
// ============================================
// Reflection evaluator prompt
// ============================================
const REFLECTION_SYSTEM_PROMPT = `You are a critical quality evaluator for AI-generated project management responses.
Your task is to evaluate a response and provide structured feedback.

Evaluation criteria (score each 0-10):
1. COMPLETENESS: Does it address ALL parts of the original request?
2. SPECIFICITY: Are recommendations concrete with specific numbers, names, dates, % values?
3. ACTIONABILITY: Can the user immediately act on this? Are next steps clear?
4. CONSISTENCY: Does it align with the context provided? No contradictions?

Respond ONLY in this exact JSON format:
{
  "completeness": <0-10>,
  "specificity": <0-10>,
  "actionability": <0-10>,
  "consistency": <0-10>,
  "overall": <weighted average 0-10>,
  "critique": "<what is missing or weak>",
  "suggestions": ["<improvement 1>", "<improvement 2>", "<improvement 3>"]
}`;
function buildReflectionPrompt(originalRequest, response, context) {
    return [
        context ? `Context provided to the agent:\n${context}\n\n` : "",
        `Original request:\n${originalRequest}\n\n`,
        `Agent response to evaluate:\n${response}`,
    ]
        .filter(Boolean)
        .join("");
}
const REVISION_SYSTEM_PREFIX = `You are improving a previous response based on quality feedback.
Apply the specific suggestions provided. Be more concrete, specific, and actionable.
Do not mention that you are revising — just produce the improved response directly.`;
// ============================================
// Parse reflection score from LLM response
// ============================================
function parseReflectionScore(raw) {
    const jsonText = extractFirstJsonObject(raw);
    if (!jsonText)
        return null;
    try {
        const parsed = JSON.parse(jsonText);
        return {
            completeness: clampScore(parsed.completeness, 5),
            specificity: clampScore(parsed.specificity, 5),
            actionability: clampScore(parsed.actionability, 5),
            consistency: clampScore(parsed.consistency, 5),
            overall: clampScore(parsed.overall, 5),
            critique: String(parsed.critique ?? ""),
            suggestions: Array.isArray(parsed.suggestions)
                ? parsed.suggestions.filter((suggestion) => {
                    return typeof suggestion === "string" && suggestion.trim().length > 0;
                })
                : [],
        };
    }
    catch {
        return null;
    }
}
// ============================================
// Main reflection function
// ============================================
async function runWithReflection(messages, options = {}) {
    const { router: injectedRouter, provider, model, maxRounds: rawMaxRounds = 2, qualityThreshold: rawQualityThreshold = 7.5, verbose = false, agentId, runId, workspaceId, } = options;
    const attribution = { agentId, runId, workspaceId };
    const maxRounds = Math.min(Math.max(Number.isFinite(rawMaxRounds) ? rawMaxRounds : 2, 1), 5);
    const qualityThreshold = Math.min(Math.max(Number.isFinite(rawQualityThreshold) ? rawQualityThreshold : 7.5, 0), 10);
    const router = injectedRouter ?? (0, providers_1.getRouter)();
    const scores = [];
    let currentResponse = "";
    let roundsCompleted = 0;
    let improved = false;
    // Extract original request from messages
    const userMessages = messages.filter((m) => m.role === "user");
    const originalRequest = userMessages[userMessages.length - 1]?.content ?? "";
    const context = messages.find((m) => m.role === "system")?.content ?? "";
    try {
        // Initial response
        currentResponse = await router.chat(messages, { provider, model, ...attribution });
        roundsCompleted++;
        if (verbose) {
            logger_1.logger.debug("reflection: initial response generated", {
                chars: currentResponse.length,
            });
        }
        // Reflection rounds
        for (let round = 0; round < maxRounds; round++) {
            // Evaluate quality
            const evalMessages = [
                { role: "system", content: REFLECTION_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: buildReflectionPrompt(originalRequest, currentResponse, context),
                },
            ];
            const evalResponse = await router.chat(evalMessages, { provider, model, ...attribution });
            const score = parseReflectionScore(evalResponse);
            if (!score) {
                logger_1.logger.warn("reflection: could not parse evaluation score", { round });
                break;
            }
            scores.push(score);
            if (verbose) {
                logger_1.logger.debug("reflection: score", {
                    round,
                    overall: score.overall,
                    critique: score.critique.slice(0, 100),
                });
            }
            // Accept if quality is sufficient
            if (score.overall >= qualityThreshold) {
                logger_1.logger.info("reflection: quality threshold met", {
                    round,
                    score: score.overall,
                    threshold: qualityThreshold,
                });
                break;
            }
            // Revise if below threshold
            const revisionMessages = [
                {
                    role: "system",
                    content: `${REVISION_SYSTEM_PREFIX}\n\n${context ? `Context:\n${context}` : ""}`,
                },
                { role: "user", content: originalRequest },
                { role: "assistant", content: currentResponse },
                {
                    role: "user",
                    content: [
                        "Quality evaluation found these issues:",
                        `Score: ${score.overall}/10`,
                        `Critique: ${score.critique}`,
                        "Improvements needed:",
                        ...score.suggestions.map((s, i) => `${i + 1}. ${s}`),
                        "",
                        "Please provide an improved response addressing all these points.",
                    ].join("\n"),
                },
            ];
            const revised = await router.chat(revisionMessages, { provider, model, ...attribution });
            if (!revised?.trim()) {
                logger_1.logger.warn("reflection: empty revision received", { round });
                break;
            }
            currentResponse = revised;
            improved = true;
            roundsCompleted++;
        }
    }
    catch (err) {
        logger_1.logger.error("reflection: error during reflection loop", {
            error: err instanceof Error ? err.message : String(err),
        });
        // Return whatever we have so far
    }
    return {
        finalResponse: currentResponse,
        roundsCompleted,
        scores,
        improved,
    };
}
/**
 * Determine if a request warrants reflection.
 * Reflection is expensive (2-3x API calls) — use selectively.
 */
function shouldReflect(prompt, agentId) {
    const HIGH_STAKES_AGENTS = new Set([
        "status-reporter",
        "budget-controller",
        "evm-analyst",
        "risk-researcher",
        "pmo-director",
    ]);
    if (!HIGH_STAKES_AGENTS.has(agentId))
        return false;
    // Only for longer, complex requests
    return prompt.length > 300;
}
function extractFirstJsonObject(raw) {
    const start = raw.indexOf("{");
    if (start === -1)
        return null;
    let depth = 0;
    for (let index = start; index < raw.length; index += 1) {
        const char = raw[index];
        if (char === "{")
            depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return raw.slice(start, index + 1);
            }
        }
    }
    return null;
}
function clampScore(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(Math.max(parsed, 0), 10);
}
