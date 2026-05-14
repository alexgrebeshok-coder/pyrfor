export class ToolForgeValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolForgeValidationError';
    }
}
export class SelfExtensionLoop {
    constructor(registry) {
        this.registry = registry;
    }
    forge(input) {
        return forgeToolCandidate(this.registry, input);
    }
}
export function evaluateToolForgeGate(registry, input) {
    const exact = registry.getByName(input.name);
    if (exact && isReusableToolStatus(exact.status)) {
        return { mode: 'reuse', reason: `active tool already exists: ${input.name}`, existingToolId: exact.id };
    }
    for (const trigger of input.capability.triggers) {
        const matching = registry.loadAll().find((entry) => isReusableToolStatus(entry.status) && toolMatchesTrigger(entry, trigger));
        if (matching) {
            return { mode: 'reuse', reason: `vetted tool already covers trigger: ${trigger}`, existingToolId: matching.id };
        }
    }
    if (input.parentToolId) {
        const parent = registry.get(input.parentToolId);
        if (!parent || !isReusableToolStatus(parent.status)) {
            throw new ToolForgeValidationError(`parent tool is not reusable: ${input.parentToolId}`);
        }
        return { mode: 'adapt', reason: `adapting parent tool: ${input.parentToolId}`, existingToolId: input.parentToolId };
    }
    return { mode: 'forge', reason: 'no reusable active tool found' };
}
export function forgeToolCandidate(registry, input) {
    var _a;
    validateToolForgeInput(input);
    const gate = evaluateToolForgeGate(registry, input);
    if (gate.mode === 'reuse') {
        const existing = registry.get(gate.existingToolId);
        if (!existing)
            throw new ToolForgeValidationError(`reuse target disappeared: ${gate.existingToolId}`);
        return {
            gate,
            entry: existing,
            lesson: buildLesson(input, existing, gate),
        };
    }
    assertNoToolForgeHashCollision(registry, input.contentHash);
    const entry = registry.register({
        name: input.name,
        kind: input.kind,
        capability: normalizeCapability(input.capability),
        implPath: input.implPath,
        contentHash: input.contentHash,
        artifactId: input.artifactId,
        testSuiteArtifactId: input.testSuiteArtifactId,
        forgedByConceptId: input.conceptId,
        parentToolId: input.parentToolId,
        tags: ['universal', 'toolforge', ...((_a = input.tags) !== null && _a !== void 0 ? _a : [])],
        status: 'sandboxed_experiment',
        trustHistory: [{
                at: new Date(0).toISOString(),
                from: 'pending_validation',
                to: 'sandboxed_experiment',
                reason: 'ToolForge M11 registration is sandbox-only until verifier promotion',
                runId: input.runId,
            }],
    });
    return {
        gate,
        entry,
        lesson: buildLesson(input, entry, gate),
    };
}
export function evictToolOnRegression(registry, toolId, failureScore, threshold = 0.75) {
    if (!Number.isFinite(failureScore) || failureScore < 0 || failureScore > 1) {
        throw new ToolForgeValidationError('failureScore must be between 0 and 1');
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new ToolForgeValidationError('threshold must be between 0 and 1');
    }
    const entry = registry.get(toolId);
    if (!entry)
        return { evicted: false, reason: `tool not found: ${toolId}` };
    if (entry.status === 'retired')
        return { evicted: false, entry, reason: 'tool already retired' };
    if (failureScore < threshold)
        return { evicted: false, entry, reason: 'failure score below eviction threshold' };
    const retired = registry.retire(toolId, `ToolForge regression eviction: failureScore=${failureScore}`);
    return { evicted: true, entry: retired, reason: 'failure score exceeded eviction threshold' };
}
function validateToolForgeInput(input) {
    var _a, _b, _c;
    if (!input.name.trim())
        throw new ToolForgeValidationError('tool name is required');
    if (!input.contentHash.trim())
        throw new ToolForgeValidationError('contentHash is required');
    if (!input.artifactId.trim())
        throw new ToolForgeValidationError('artifactId is required');
    if (!input.testSuiteArtifactId.trim())
        throw new ToolForgeValidationError('testSuiteArtifactId is required');
    if (!input.staticAnalysis.passed) {
        throw new ToolForgeValidationError(`static analysis failed: ${((_a = input.staticAnalysis.findings) !== null && _a !== void 0 ? _a : []).join('; ') || 'no details'}`);
    }
    if (!input.dynamicTests.passed) {
        throw new ToolForgeValidationError(`dynamic tests failed: ${((_b = input.dynamicTests.findings) !== null && _b !== void 0 ? _b : []).join('; ') || 'no details'}`);
    }
    validateTocGate(input.tocGate);
    if (input.capability.requiredSandboxTier === 'host' || input.capability.requiredSandboxTier === 'container_full') {
        throw new ToolForgeValidationError(`ToolForge cannot create privileged sandbox tier: ${input.capability.requiredSandboxTier}`);
    }
    if ((input.capability.declaredEffects.includes('net.out') || input.capability.declaredEffects.includes('net.in')) &&
        ((_c = input.capability.egressAllowlist) !== null && _c !== void 0 ? _c : []).length === 0) {
        throw new ToolForgeValidationError('network effects require an explicit egressAllowlist');
    }
}
function validateTocGate(tocGate) {
    const missing = Object.entries(tocGate)
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key);
    if (missing.length > 0) {
        throw new ToolForgeValidationError(`TOC gate missing artifacts: ${missing.join(', ')}`);
    }
}
function assertNoToolForgeHashCollision(registry, contentHash) {
    const existing = registry.loadAll().find((entry) => entry.contentHash === contentHash);
    if (!existing)
        return;
    throw new ToolForgeValidationError(`contentHash collision with existing tool: ${existing.id} (${existing.status})`);
}
function isReusableToolStatus(status) {
    return status === 'vetted' || status === 'trusted' || status === 'core';
}
function toolMatchesTrigger(entry, trigger) {
    const needle = trigger.trim().toLowerCase();
    if (!needle)
        return false;
    return [
        entry.name,
        entry.capability.description,
        ...entry.capability.triggers,
    ].join(' ').toLowerCase().includes(needle);
}
function normalizeCapability(capability) {
    return Object.assign(Object.assign({}, capability), { requiredTrustTier: 'pending_validation' });
}
function buildLesson(input, entry, gate) {
    var _a, _b;
    return {
        schemaVersion: 'pyrfor.toolforge.lesson.v1',
        runId: input.runId,
        conceptId: input.conceptId,
        toolId: entry.id,
        mode: gate.mode,
        evidenceArtifacts: [
            input.tocGate.bottleneck_proof,
            input.tocGate.reuse_analysis,
            input.tocGate.adaptation_impossible_justification,
            input.tocGate.forge_justification,
            input.artifactId,
            input.testSuiteArtifactId,
            input.staticAnalysis.artifactId,
            input.dynamicTests.artifactId,
        ],
        promotedStatus: 'sandboxed_experiment',
        findings: [
            ...((_a = input.staticAnalysis.findings) !== null && _a !== void 0 ? _a : []),
            ...((_b = input.dynamicTests.findings) !== null && _b !== void 0 ? _b : []),
        ],
    };
}
