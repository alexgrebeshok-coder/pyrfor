import { createHash } from 'node:crypto';
import { parseSkillMd } from '../skills/skill-md-parser';
import type { RegistryEntry, SandboxTier, ToolCapabilityManifest, ToolRegistry, ToolStatus } from './universal/tool-registry';

export const MAX_SKILL_MD_BYTES = 128 * 1024;

const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_TRIGGER_CHARS = 80;
const MAX_TRIGGERS = 20;
const LOCAL_PATH_RE = /(?:^|[\s("'=])((?:~\/|\/)(?:[^\s"'<>`{}|\\]+\/?)+)/g;
const SECRET_ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi;

export interface SkillImportRequest {
  content: string;
  sourceLabel?: string;
}

export interface PublicToolRegistryEntry {
  id: string;
  name: string;
  kind: RegistryEntry['kind'];
  status: ToolStatus;
  capability: ToolCapabilityManifest;
  artifactId: string;
  testSuiteArtifactId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  quality: {
    testsPassed: boolean;
    lastTestResultArtifactId?: string;
    failureScore: number;
    sandboxTier: SandboxTier;
    approvalRequired: boolean;
    provenance: 'imported' | 'forged' | 'adapted' | 'user-authored' | 'bundled' | 'unknown';
    provenanceTrust: 'quarantined' | 'sandboxed' | 'vetted' | 'trusted' | 'core';
  };
}

export interface SkillImportResult {
  schemaVersion: 'pyrfor.skill_import.v1';
  imported: boolean;
  duplicate: boolean;
  entry: PublicToolRegistryEntry;
  warnings: string[];
}

export interface ToolRegistryListResult {
  schemaVersion: 'pyrfor.tool_registry.v1';
  total: number;
  tools: PublicToolRegistryEntry[];
}

export function importSkillMdToRegistry(registry: ToolRegistry, request: SkillImportRequest): SkillImportResult {
  const content = validateSkillContent(request.content);
  const parsed = parseSkillMd(content, safeSourceLabel(request.sourceLabel));
  if (!parsed) throw new Error('invalid_skill_md');

  const hash = createHash('sha256').update(content).digest('hex');
  const triggerText = parsed.trigger ?? parsed.name;
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

export function listPublicToolRegistry(
  registry: ToolRegistry,
  query: { status?: ToolStatus | 'active'; tags?: string[]; limit?: number } = {},
): ToolRegistryListResult {
  const tools = registry.find(query)
    .map(publicToolRegistryEntry)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 'pyrfor.tool_registry.v1',
    total: tools.length,
    tools,
  };
}

export function publicToolRegistryEntry(entry: RegistryEntry): PublicToolRegistryEntry {
  const provenance = provenanceFromTags(entry.tags);
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    status: entry.status,
    capability: {
      ...entry.capability,
      description: redactSensitiveText(entry.capability.description),
      triggers: entry.capability.triggers.map((trigger) => redactSensitiveText(trigger)),
      egressAllowlist: entry.capability.egressAllowlist ? [...entry.capability.egressAllowlist] : undefined,
      fsScope: entry.capability.fsScope ? entry.capability.fsScope.map(() => '[redacted-path]') : undefined,
    },
    artifactId: entry.artifactId,
    testSuiteArtifactId: entry.testSuiteArtifactId,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tags: [...entry.tags],
    quality: {
      testsPassed: Boolean(entry.lastTestResultArtifactId) && entry.failureScore === 0 && reusableStatus(entry.status),
      lastTestResultArtifactId: entry.lastTestResultArtifactId,
      failureScore: entry.failureScore,
      sandboxTier: entry.capability.requiredSandboxTier,
      approvalRequired: !reusableStatus(entry.status),
      provenance,
      provenanceTrust: provenanceTrust(entry.status),
    },
  };
}

function validateSkillContent(content: string): string {
  if (typeof content !== 'string' || !content.trim()) throw new Error('skill_content_required');
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_MD_BYTES) throw new Error('skill_content_too_large');
  return content;
}

function normalizeSkillName(name: string): string {
  const normalized = truncate(name.trim().replace(/\s+/g, ' '), MAX_NAME_CHARS);
  if (!normalized) throw new Error('skill_name_required');
  return normalized;
}

function splitTriggers(value: string): string[] {
  const triggers = value
    .split(/[\s,]+/)
    .map((trigger) => truncate(redactSensitiveText(trigger.trim().toLowerCase()), MAX_TRIGGER_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TRIGGERS);
  return triggers.length > 0 ? [...new Set(triggers)] : ['skill'];
}

function safeSourceLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const basename = value.split(/[\\/]/).filter(Boolean).pop() ?? value;
  return truncate(redactSensitiveText(basename.replace(/\s+/g, ' ').trim()), MAX_NAME_CHARS);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT_RE, '$1=[redacted-secret]')
    .replace(LOCAL_PATH_RE, (match, localPath: string) => match.replace(localPath, '[redacted-path]'));
}

function provenanceFromTags(tags: string[]): PublicToolRegistryEntry['quality']['provenance'] {
  if (tags.includes('provenance:imported')) return 'imported';
  if (tags.includes('toolforge')) return 'forged';
  if (tags.includes('provenance:adapted')) return 'adapted';
  if (tags.includes('provenance:user-authored')) return 'user-authored';
  if (tags.includes('provenance:bundled')) return 'bundled';
  return 'unknown';
}

function provenanceTrust(status: ToolStatus): PublicToolRegistryEntry['quality']['provenanceTrust'] {
  if (status === 'trusted') return 'trusted';
  if (status === 'core') return 'core';
  if (status === 'vetted') return 'vetted';
  if (status === 'sandboxed_experiment') return 'sandboxed';
  return 'quarantined';
}

function reusableStatus(status: ToolStatus): boolean {
  return status === 'vetted' || status === 'trusted' || status === 'core';
}
