import path from 'node:path';
import { stableStringify } from '../context-pack';
import type { ToolCapabilityManifest } from './tool-registry';

export type EffectOperation = ToolCapabilityManifest['declaredEffects'][number];

export interface EffectRequest {
  runId: string;
  toolName: string;
  effect: EffectOperation;
  targetPath?: string;
  url?: string;
  estimatedCostUsd?: number;
  estimatedWallMs?: number;
  estimatedEgressBytes?: number;
  capability: ToolCapabilityManifest;
}

export interface EffectDecision {
  allowed: boolean;
  reason: string;
  effect: EffectOperation;
  toolName: string;
}

export interface AllowedEffect {
  request: EffectRequest;
  decision: EffectDecision;
  artifactId?: string;
}

export interface EffectGateway {
  authorize(request: EffectRequest): EffectDecision;
  journal(entry: AllowedEffect): string;
  entries(): string[];
}

export function createEffectGateway(): EffectGateway {
  const journalEntries: string[] = [];

  function authorize(request: EffectRequest): EffectDecision {
    if (!request.capability.declaredEffects.includes(request.effect)) {
      return deny(request, `effect "${request.effect}" is not declared by capability manifest`);
    }
    if ((request.effect === 'fs.read' || request.effect === 'fs.write') && request.targetPath) {
      if (!isPathAllowed(request.targetPath, request.capability.fsScope ?? [])) {
        return deny(request, `path outside declared fsScope: ${request.targetPath}`);
      }
    }
    if ((request.effect === 'net.out' || request.effect === 'net.in') && request.url) {
      if (!isUrlAllowed(request.url, request.capability.egressAllowlist ?? [])) {
        return deny(request, `url outside declared egressAllowlist: ${request.url}`);
      }
    }
    const budgetReason = checkBudget(request);
    if (budgetReason) return deny(request, budgetReason);
    return {
      allowed: true,
      reason: 'effect allowed by capability manifest',
      effect: request.effect,
      toolName: request.toolName,
    };
  }

  function journal(entry: AllowedEffect): string {
    if (!entry.decision.allowed) throw new Error('EffectGateway: denied effects cannot be journaled as allowed');
    const line = `${stableStringify({
      artifactId: entry.artifactId,
      decision: entry.decision,
      request: entry.request,
    })}\n`;
    journalEntries.push(line);
    return line;
  }

  return {
    authorize,
    journal,
    entries: () => [...journalEntries],
  };
}

function deny(request: EffectRequest, reason: string): EffectDecision {
  return {
    allowed: false,
    reason,
    effect: request.effect,
    toolName: request.toolName,
  };
}

function isPathAllowed(targetPath: string, fsScope: string[]): boolean {
  if (fsScope.length === 0) return false;
  const resolvedTarget = path.resolve(targetPath);
  return fsScope.some((scope) => {
    const resolvedScope = path.resolve(scope);
    return resolvedTarget === resolvedScope || resolvedTarget.startsWith(`${resolvedScope}${path.sep}`);
  });
}

function isUrlAllowed(rawUrl: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  let host: string;
  try {
    host = new URL(rawUrl).host;
  } catch {
    return false;
  }
  return allowlist.some((allowed) => host === allowed);
}

function checkBudget(request: EffectRequest): string | undefined {
  const budget = request.capability.perCallBudget;
  if (!budget) return undefined;
  if (budget.tokensUSD !== undefined && (request.estimatedCostUsd ?? 0) > budget.tokensUSD) {
    return `estimated cost exceeds per-call budget: ${request.estimatedCostUsd ?? 0} > ${budget.tokensUSD}`;
  }
  if (budget.wallMs !== undefined && (request.estimatedWallMs ?? 0) > budget.wallMs) {
    return `estimated wall time exceeds per-call budget: ${request.estimatedWallMs ?? 0} > ${budget.wallMs}`;
  }
  if (budget.egressKB !== undefined && (request.estimatedEgressBytes ?? 0) > budget.egressKB * 1024) {
    return `estimated egress exceeds per-call budget: ${request.estimatedEgressBytes ?? 0} > ${budget.egressKB * 1024}`;
  }
  return undefined;
}
