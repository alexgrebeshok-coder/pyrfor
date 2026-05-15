var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
import { parseSkillMd } from '../skills/skill-md-parser.js';
export const MAX_SKILL_MD_BYTES = 128 * 1024;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_TRIGGER_CHARS = 80;
const MAX_TRIGGERS = 20;
const LOCAL_PATH_RE = /(?:^|[\s("'=])((?:~\/|\/)(?:[^\s"'<>`{}|\\]+\/?)+)/g;
const SECRET_ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi;
export function importSkillMdToRegistry(registry, request) {
    var _a;
    const content = validateSkillContent(request.content);
    const parsed = parseSkillMd(content, safeSourceLabel(request.sourceLabel));
    if (!parsed)
        throw new Error('invalid_skill_md');
    const hash = createHash('sha256').update(content).digest('hex');
    const triggerText = (_a = parsed.trigger) !== null && _a !== void 0 ? _a : parsed.name;
    const triggers = splitTriggers(triggerText);
    const sourceLabel = safeSourceLabel(request.sourceLabel);
    const skillName = normalizeSkillName(redactSensitiveText(parsed.name));
    const registered = registry.registerWithDisposition({
        name: `skill:${slugify(skillName)}`,
        kind: 'skill',
        capability: {
            description: truncate(redactSensitiveText(parsed.description || skillName), MAX_DESCRIPTION_CHARS),
            triggers,
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: { type: 'string' },
                    context: { type: 'object' },
                },
                required: ['query'],
            },
            outputSchema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    success: { type: 'boolean' },
                    result: { type: 'string' },
                },
                required: ['success', 'result'],
            },
            declaredEffects: [],
            requiredTrustTier: 'pending_validation',
            requiredSandboxTier: 'wasm',
        },
        implPath: `skill://${sourceLabel ? slugify(redactSensitiveText(sourceLabel)) : slugify(skillName)}`,
        contentHash: hash,
        artifactId: `skill-md-${hash.slice(0, 16)}`,
        testSuiteArtifactId: `skill-tests-pending-${hash.slice(0, 16)}`,
        tags: [
            'universal',
            'skill-import',
            'provenance:imported',
            'state:quarantined',
            ...(parsed.category ? [`category:${slugify(parsed.category)}`] : []),
        ],
        status: 'pending_validation',
        trustHistory: [{
                at: new Date(0).toISOString(),
                from: 'pending_validation',
                to: 'pending_validation',
                reason: 'Imported SKILL.md is quarantined until tests and approval promote it',
            }],
    });
    const entry = registered.entry;
    return {
        schemaVersion: 'pyrfor.skill_import.v1',
        imported: registered.created,
        duplicate: !registered.created,
        entry: publicToolRegistryEntry(entry),
        warnings: [
            'Imported skill is visible but not executable until validation and approval are implemented.',
            'Raw SKILL.md prompt and local source path are intentionally omitted from public responses.',
        ],
    };
}
export function listPublicToolRegistry(registry, query = {}) {
    const tools = registry.find(query)
        .map(publicToolRegistryEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        schemaVersion: 'pyrfor.tool_registry.v1',
        total: tools.length,
        tools,
    };
}
export function testSkillRegistryEntry(registry_1, skillRef_1) {
    return __awaiter(this, arguments, void 0, function* (registry, skillRef, deps = {}) {
        var _a, _b, _c;
        const entry = resolveSkillEntry(registry, skillRef);
        let checks = [];
        let failureScore = 1;
        const updated = registry.update(entry.id, (current) => {
            checks = buildSkillValidationChecks(current);
            const failedChecks = checks.filter((check) => !check.passed);
            failureScore = checks.length === 0 ? 1 : failedChecks.length / checks.length;
            return Object.assign(Object.assign({}, current), { lastTestResultArtifactId: `skill-test-${current.id}`, failureScore });
        });
        if (!updated)
            throw new Error('skill_not_found');
        let finalEntry = updated;
        let testResultArtifactId = (_a = updated.lastTestResultArtifactId) !== null && _a !== void 0 ? _a : `skill-test-${updated.id}`;
        if ((_b = deps.artifactStore) === null || _b === void 0 ? void 0 : _b.writeJSON) {
            const artifact = yield deps.artifactStore.writeJSON('test_result', {
                schemaVersion: 'pyrfor.skill_test_result.v1',
                skillId: updated.id,
                skillName: updated.name,
                checkedAt: new Date().toISOString(),
                passed: checks.every((check) => check.passed),
                failureScore,
                checks,
            }, {
                meta: { skillId: updated.id, skillName: updated.name, source: 'skills:test' },
            });
            testResultArtifactId = artifact.id;
            finalEntry = (_c = registry.update(updated.id, (current) => (Object.assign(Object.assign({}, current), { lastTestResultArtifactId: artifact.id })))) !== null && _c !== void 0 ? _c : updated;
        }
        const failedChecks = checks.filter((check) => !check.passed);
        return {
            schemaVersion: 'pyrfor.skill_test.v1',
            passed: failedChecks.length === 0,
            skillRef,
            checks,
            failureScore,
            testResultArtifactId,
            entry: publicToolRegistryEntry(finalEntry),
        };
    });
}
export function approveSkillRegistryEntry(registry, skillRef) {
    const entry = resolveSkillEntry(registry, skillRef);
    let promotedFrom;
    let alreadyApproved = false;
    const updated = registry.update(entry.id, (current) => (Object.assign({}, (() => {
        if (current.status === 'retired')
            throw new Error('skill_retired');
        if (!current.lastTestResultArtifactId)
            throw new Error('skill_tests_required');
        if (current.failureScore > 0)
            throw new Error('skill_validation_failed');
        promotedFrom = current.status;
        if (reusableStatus(current.status)) {
            alreadyApproved = true;
            return current;
        }
        return Object.assign(Object.assign({}, current), { status: 'vetted', capability: Object.assign(Object.assign({}, current.capability), { requiredTrustTier: 'vetted' }), tags: replaceStateTag(current.tags, 'state:vetted'), trustHistory: [
                ...current.trustHistory,
                {
                    at: new Date().toISOString(),
                    from: current.status,
                    to: 'vetted',
                    reason: 'Imported skill approved after passing governed validation',
                },
            ] });
    })())));
    if (!updated || !promotedFrom)
        throw new Error('skill_not_found');
    return {
        schemaVersion: 'pyrfor.skill_approval.v1',
        approved: true,
        alreadyApproved,
        skillRef,
        promotedFrom,
        promotedTo: updated.status,
        entry: publicToolRegistryEntry(updated),
    };
}
export function publicToolRegistryEntry(entry) {
    const provenance = provenanceFromTags(entry.tags);
    return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        status: entry.status,
        capability: Object.assign(Object.assign({}, entry.capability), { description: redactSensitiveText(entry.capability.description), triggers: entry.capability.triggers.map((trigger) => redactSensitiveText(trigger)), egressAllowlist: entry.capability.egressAllowlist ? [...entry.capability.egressAllowlist] : undefined, fsScope: entry.capability.fsScope ? entry.capability.fsScope.map(() => '[redacted-path]') : undefined }),
        artifactId: entry.artifactId,
        testSuiteArtifactId: entry.testSuiteArtifactId,
        version: entry.version,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        tags: [...entry.tags],
        quality: {
            testsPassed: Boolean(entry.lastTestResultArtifactId) && entry.failureScore === 0,
            lastTestResultArtifactId: entry.lastTestResultArtifactId,
            failureScore: entry.failureScore,
            sandboxTier: entry.capability.requiredSandboxTier,
            approvalRequired: !reusableStatus(entry.status),
            provenance,
            provenanceTrust: provenanceTrust(entry.status),
        },
    };
}
function validateSkillContent(content) {
    if (typeof content !== 'string' || !content.trim())
        throw new Error('skill_content_required');
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_MD_BYTES)
        throw new Error('skill_content_too_large');
    return content;
}
function normalizeSkillName(name) {
    const normalized = truncate(name.trim().replace(/\s+/g, ' '), MAX_NAME_CHARS);
    if (!normalized)
        throw new Error('skill_name_required');
    return normalized;
}
function splitTriggers(value) {
    const triggers = value
        .split(/[\s,]+/)
        .map((trigger) => truncate(redactSensitiveText(trigger.trim().toLowerCase()), MAX_TRIGGER_CHARS))
        .filter(Boolean)
        .slice(0, MAX_TRIGGERS);
    return triggers.length > 0 ? [...new Set(triggers)] : ['skill'];
}
function safeSourceLabel(value) {
    var _a;
    if (!value)
        return undefined;
    const basename = (_a = value.split(/[\\/]/).filter(Boolean).pop()) !== null && _a !== void 0 ? _a : value;
    return truncate(redactSensitiveText(basename.replace(/\s+/g, ' ').trim()), MAX_NAME_CHARS);
}
function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'skill';
}
function truncate(value, max) {
    return value.length <= max ? value : value.slice(0, max);
}
function redactSensitiveText(value) {
    return value
        .replace(SECRET_ASSIGNMENT_RE, '$1=[redacted-secret]')
        .replace(LOCAL_PATH_RE, (match, localPath) => match.replace(localPath, '[redacted-path]'));
}
function provenanceFromTags(tags) {
    if (tags.includes('provenance:imported'))
        return 'imported';
    if (tags.includes('toolforge'))
        return 'forged';
    if (tags.includes('provenance:adapted'))
        return 'adapted';
    if (tags.includes('provenance:user-authored'))
        return 'user-authored';
    if (tags.includes('provenance:bundled'))
        return 'bundled';
    return 'unknown';
}
function provenanceTrust(status) {
    if (status === 'trusted')
        return 'trusted';
    if (status === 'core')
        return 'core';
    if (status === 'vetted')
        return 'vetted';
    if (status === 'sandboxed_experiment')
        return 'sandboxed';
    return 'quarantined';
}
function reusableStatus(status) {
    return status === 'vetted' || status === 'trusted' || status === 'core';
}
function resolveSkillEntry(registry, skillRef) {
    var _a;
    const normalized = skillRef.trim();
    const entry = (_a = registry.get(normalized)) !== null && _a !== void 0 ? _a : registry.getByName(normalized);
    if (!entry || entry.kind !== 'skill')
        throw new Error('skill_not_found');
    return entry;
}
function buildSkillValidationChecks(entry) {
    const expectedTrustTier = reusableStatus(entry.status) ? entry.status : 'pending_validation';
    return [
        {
            id: 'skill-kind',
            description: 'Registry entry kind remains skill',
            passed: entry.kind === 'skill',
        },
        {
            id: 'skill-name-prefix',
            description: 'Registry entry name keeps the skill: prefix',
            passed: entry.name.startsWith('skill:'),
        },
        {
            id: 'skill-trigger-list',
            description: 'Skill exposes at least one sanitized trigger',
            passed: Array.isArray(entry.capability.triggers) && entry.capability.triggers.length > 0,
        },
        {
            id: 'skill-sandbox-tier',
            description: 'Imported skills stay within wasm sandbox tier',
            passed: entry.capability.requiredSandboxTier === 'wasm',
        },
        {
            id: 'skill-trust-tier',
            description: 'Capability trust tier matches governed status',
            passed: entry.capability.requiredTrustTier === expectedTrustTier,
        },
        {
            id: 'skill-import-tag',
            description: 'Imported skills retain the skill-import registry tag',
            passed: entry.tags.includes('skill-import'),
        },
        {
            id: 'skill-artifact-ids',
            description: 'Skill registry entry keeps stable source and test artifact ids',
            passed: Boolean(entry.artifactId) && Boolean(entry.testSuiteArtifactId),
        },
    ];
}
function replaceStateTag(tags, nextStateTag) {
    return [...tags.filter((tag) => !tag.startsWith('state:')), nextStateTag];
}
