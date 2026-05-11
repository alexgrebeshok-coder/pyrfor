import { describe, expect, it } from 'vitest';
import { createEffectGateway, type EffectRequest } from './effect-gateway';
import type { ToolCapabilityManifest } from './tool-registry';

describe('EffectGateway', () => {
  it('allows declared file effects inside fsScope', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'fs.write',
      targetPath: '/workspace/project/file.txt',
    }));

    expect(decision.allowed).toBe(true);
  });

  it('denies undeclared effects', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({ effect: 'process.spawn' }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not declared/);
  });

  it('denies file effects outside declared fsScope', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'fs.write',
      targetPath: '/workspace/other/file.txt',
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/outside declared fsScope/);
  });

  it('allows egress URLs on the manifest allowlist', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'net.out',
      url: 'https://api.example.com/v1/search',
    }));

    expect(decision.allowed).toBe(true);
  });

  it('denies egress URLs outside the manifest allowlist', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'net.out',
      url: 'https://evil.example.net/',
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/outside declared egressAllowlist/);
  });

  it('denies effects that exceed declared budgets', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'net.out',
      url: 'https://api.example.com/v1/search',
      estimatedEgressBytes: 4096,
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/egress exceeds/);
  });

  it('blocks effects when the tier decider already blocked them', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'fs.read',
      tierDecision: 'block',
      tierReasonCodes: ['gate_failed'],
      decisionVectorRef: 'artifact:decision-vector-1',
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/tier decider/);
    expect(decision).toMatchObject({
      tierDecision: 'block',
      reasonCodes: ['gate_failed'],
      decisionVectorRef: 'artifact:decision-vector-1',
    });
  });

  it('carries approval-tier metadata on allowed decisions', () => {
    const gateway = createEffectGateway();

    const decision = gateway.authorize(request({
      effect: 'fs.read',
      tierDecision: 'approve',
      tierReasonCodes: ['irreversible_effect'],
      decisionVectorRef: 'artifact:decision-vector-2',
      requiresApproval: true,
    }));

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({
      tierDecision: 'approve',
      reasonCodes: ['irreversible_effect'],
      decisionVectorRef: 'artifact:decision-vector-2',
      requiresApproval: true,
    });
  });

  it('journals allowed effects as deterministic JSONL', () => {
    const gateway = createEffectGateway();
    const effect = request({
      effect: 'fs.read',
      targetPath: '/workspace/project/input.txt',
    });
    const decision = gateway.authorize(effect);

    const first = gateway.journal({ request: effect, decision, artifactId: 'artifact-1' });
    const second = gateway.journal({ request: effect, decision, artifactId: 'artifact-1' });

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(gateway.entries()).toHaveLength(2);
  });

  it('refuses to journal denied effects as allowed', () => {
    const gateway = createEffectGateway();
    const effect = request({ effect: 'process.spawn' });
    const decision = gateway.authorize(effect);

    expect(() => gateway.journal({ request: effect, decision })).toThrow(/denied effects/);
  });
});

function request(overrides: Partial<EffectRequest>): EffectRequest {
  return {
    runId: 'run-1',
    toolName: 'tool-a',
    effect: 'fs.read',
    targetPath: '/workspace/project/input.txt',
    capability: manifest(),
    ...overrides,
  };
}

function manifest(overrides: Partial<ToolCapabilityManifest> = {}): ToolCapabilityManifest {
  return {
    description: 'Test capability',
    triggers: ['test'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    declaredEffects: ['fs.read', 'fs.write', 'net.out'],
    requiredTrustTier: 'pending_validation',
    requiredSandboxTier: 'wasm',
    fsScope: ['/workspace/project'],
    egressAllowlist: ['api.example.com'],
    perCallBudget: { egressKB: 1, wallMs: 1_000, tokensUSD: 0.01 },
    ...overrides,
  };
}
