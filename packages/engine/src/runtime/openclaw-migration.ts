import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import { storeMemory, type MemoryType, type MemoryWriteOptions } from '../ai/memory/agent-memory-store';

export interface OpenClawMigrationOptions {
  workspaceId: string;
  sourcePath?: string;
  projectId?: string;
  includePersonality?: boolean;
  includeMemories?: boolean;
  maxFiles?: number;
  allowNonCanonicalSourceRoot?: boolean;
}

export interface OpenClawMigrationEntry {
  sourceRelPath: string;
  sourceKind: 'personality' | 'memory' | 'skill';
  memoryType: MemoryType;
  fingerprint: string;
  bytes: number;
  mtime: string;
  summary: string;
  redactionCount: number;
}

export interface OpenClawMigrationSkipped {
  sourceRelPath: string;
  reason: string;
}

export interface OpenClawMigrationReport {
  schemaVersion: 'openclaw_migration_report.v1';
  generatedAt: string;
  workspaceId: string;
  projectId?: string;
  sourceRoot: string;
  counts: {
    importable: number;
    skipped: number;
    personality: number;
    memories: number;
    skills: number;
    redactions: number;
  };
  entries: OpenClawMigrationEntry[];
  skipped: OpenClawMigrationSkipped[];
}

export interface OpenClawMigrationPreviewResult {
  artifact: ArtifactRef;
  report: OpenClawMigrationReport;
}

export interface OpenClawMigrationImportResult {
  imported: number;
  skipped: number;
  memoryIds: string[];
  artifact: ArtifactRef;
}

export interface OpenClawMigrationDeps {
  artifactStore: ArtifactStore;
  memoryWriter?: (options: MemoryWriteOptions) => Promise<string>;
  now?: () => Date;
}

const ROOT_PERSONALITY_FILES: Record<string, { sourceKind: 'personality'; memoryType: MemoryType }> = {
  'IDENTITY.md': { sourceKind: 'personality', memoryType: 'policy' },
  'SOUL.md': { sourceKind: 'personality', memoryType: 'policy' },
  'USER.md': { sourceKind: 'personality', memoryType: 'semantic' },
  'MEMORY.md': { sourceKind: 'personality', memoryType: 'semantic' },
  'AGENTS.md': { sourceKind: 'personality', memoryType: 'policy' },
  'HEARTBEAT.md': { sourceKind: 'personality', memoryType: 'procedural' },
  'TOOLS.md': { sourceKind: 'personality', memoryType: 'policy' },
};

const MAX_FILE_BYTES = 256 * 1024;

export async function previewOpenClawMigration(
  deps: OpenClawMigrationDeps,
  options: OpenClawMigrationOptions,
): Promise<OpenClawMigrationPreviewResult> {
  const report = await buildOpenClawMigrationReport(deps, options);
  const artifact = await deps.artifactStore.writeJSON('summary', report, {
    meta: {
      memoryKind: 'openclaw_import_report',
      schemaVersion: report.schemaVersion,
      workspaceId: options.workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
  });
  return { artifact, report };
}

export async function importOpenClawMigration(
  deps: OpenClawMigrationDeps,
  input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
  },
): Promise<OpenClawMigrationImportResult> {
  if (input.expectedReportSha256 && input.reportArtifact?.sha256 !== input.expectedReportSha256) {
    throw new Error('OpenClaw migration report sha256 mismatch');
  }
  const report = await resolveImportReport(deps, input);
  const memoryWriter = deps.memoryWriter ?? storeMemory;
  const memoryIds: string[] = [];
  let skipped = 0;
  for (const entry of report.entries) {
    const absolutePath = safeResolve(report.sourceRoot, entry.sourceRelPath);
    const raw = await readOpenClawTextFile(report.sourceRoot, entry.sourceRelPath);
    const normalized = normalizeContent(raw);
    if (fingerprint(entry.sourceRelPath, normalized) !== entry.fingerprint) {
      skipped += 1;
      continue;
    }
    const redacted = redactContent(normalized).content;
    const memoryId = await memoryWriter({
      agentId: 'pyrfor-runtime',
      workspaceId: report.workspaceId,
      projectId: report.projectId,
      memoryType: entry.memoryType,
      content: redacted,
      summary: entry.summary,
      importance: entry.sourceKind === 'personality' ? 0.86 : 0.74,
      metadata: {
        migratedFrom: 'openclaw',
        sourcePath: absolutePath,
        sourceRelPath: entry.sourceRelPath,
        sourceKind: entry.sourceKind,
        fingerprint: entry.fingerprint,
        rollupKind: entry.sourceKind === 'personality' ? 'openclaw_personality' : 'openclaw_memory',
        scope: {
          visibility: report.projectId ? 'project' : 'workspace',
          workspaceId: report.workspaceId,
          ...(report.projectId ? { projectId: report.projectId } : {}),
        },
        confidence: 0.82,
        provenance: [{ kind: 'external' as const, ref: entry.sourceRelPath, ts: entry.mtime }],
      },
    });
    if (memoryId === 'short-term-only') throw new Error('OpenClaw migration memory was not durably persisted');
    memoryIds.push(memoryId);
  }
  const artifact = await deps.artifactStore.writeJSON('summary', {
    schemaVersion: 'openclaw_migration_result.v1',
    importedAt: (deps.now ?? (() => new Date()))().toISOString(),
    reportArtifactId: input.reportArtifact?.id,
    reportSha256: input.reportArtifact?.sha256,
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    imported: memoryIds.length,
    skipped,
    memoryIds,
  }, {
    meta: {
      memoryKind: 'openclaw_import_result',
      workspaceId: report.workspaceId,
      ...(report.projectId ? { projectId: report.projectId } : {}),
    },
  });
  return { imported: memoryIds.length, skipped, memoryIds, artifact };
}

async function resolveImportReport(
  deps: OpenClawMigrationDeps,
  input: {
    report?: OpenClawMigrationReport;
    expectedReportSha256?: string;
    reportArtifact?: ArtifactRef;
    allowNonCanonicalSourceRoot?: boolean;
  },
): Promise<OpenClawMigrationReport> {
  if (input.reportArtifact && input.expectedReportSha256) {
    const report = await deps.artifactStore.readJSONVerified<OpenClawMigrationReport>(
      input.reportArtifact,
      input.expectedReportSha256,
    );
    if (input.reportArtifact.meta?.memoryKind !== 'openclaw_import_report') {
      throw new Error('OpenClaw migration artifact kind mismatch');
    }
    if (input.reportArtifact.meta?.workspaceId !== report.workspaceId) {
      throw new Error('OpenClaw migration artifact workspace mismatch');
    }
    const artifactProjectId = input.reportArtifact.meta?.projectId;
    if ((artifactProjectId ?? undefined) !== (report.projectId ?? undefined)) {
      throw new Error('OpenClaw migration artifact project mismatch');
    }
    assertAllowedReportSourceRoot(report, input.allowNonCanonicalSourceRoot === true);
    return report;
  }
  if (!input.report) throw new Error('OpenClaw migration report is required');
  assertAllowedReportSourceRoot(input.report, input.allowNonCanonicalSourceRoot === true);
  return input.report;
}

export function isAllowedOpenClawReportSourceRoot(report: OpenClawMigrationReport): boolean {
  return isAllowedSourceRoot(report.sourceRoot);
}

function assertAllowedReportSourceRoot(report: OpenClawMigrationReport, allowNonCanonicalSourceRoot: boolean): void {
  if (!isAllowedSourceRoot(report.sourceRoot, allowNonCanonicalSourceRoot)) {
    throw new Error('OpenClaw migration report source root is not an allowed workspace root');
  }
}

export async function discoverOpenClawSourceRoots(): Promise<string[]> {
  const candidates = [
    path.join(homedir(), '.openclaw', 'workspace'),
    path.join(homedir(), 'openclaw-workspace'),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) existing.push(candidate);
  }
  return existing;
}

export async function buildOpenClawMigrationReport(
  deps: Pick<OpenClawMigrationDeps, 'now'>,
  options: OpenClawMigrationOptions,
): Promise<OpenClawMigrationReport> {
  const sourceRoot = await resolveSourceRoot(options.sourcePath, options.allowNonCanonicalSourceRoot === true);
  const includePersonality = options.includePersonality !== false;
  const includeMemories = options.includeMemories !== false;
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 500, 2_000));
  const skipped: OpenClawMigrationSkipped[] = [];
  const discovered = await discoverImportableFiles(sourceRoot, { includePersonality, includeMemories, maxFiles, skipped });
  const entries: OpenClawMigrationEntry[] = [];
  const seen = new Set<string>();
  for (const file of discovered) {
    const absolutePath = path.join(sourceRoot, file.sourceRelPath);
    const info = await lstat(absolutePath);
    if (!info.isFile()) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'denied_path' });
      continue;
    }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'file_too_large' });
      continue;
    }
    const normalized = normalizeContent(await readOpenClawTextFile(sourceRoot, file.sourceRelPath));
    const fp = fingerprint(file.sourceRelPath, normalized);
    if (seen.has(fp)) {
      skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'duplicate_in_batch' });
      continue;
    }
    seen.add(fp);
    const redacted = redactContent(normalized);
    entries.push({
      sourceRelPath: file.sourceRelPath,
      sourceKind: file.sourceKind,
      memoryType: file.memoryType,
      fingerprint: fp,
      bytes: Buffer.byteLength(redacted.content, 'utf-8'),
      mtime: info.mtime.toISOString(),
      summary: summarize(file.sourceRelPath, redacted.content),
      redactionCount: redacted.count,
    });
  }
  return {
    schemaVersion: 'openclaw_migration_report.v1',
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    workspaceId: options.workspaceId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    sourceRoot,
    counts: {
      importable: entries.length,
      skipped: skipped.length,
      personality: entries.filter((entry) => entry.sourceKind === 'personality').length,
      memories: entries.filter((entry) => entry.sourceKind === 'memory').length,
      skills: entries.filter((entry) => entry.sourceKind === 'skill').length,
      redactions: entries.reduce((sum, entry) => sum + entry.redactionCount, 0),
    },
    entries,
    skipped,
  };
}

async function resolveSourceRoot(sourcePath: string | undefined, allowNonCanonicalSourceRoot: boolean): Promise<string> {
  const roots = sourcePath ? [path.resolve(sourcePath)] : await discoverOpenClawSourceRoots();
  const sourceRoot = roots[0];
  if (!sourceRoot) throw new Error('No OpenClaw workspace source found');
  if (!isAllowedSourceRoot(sourceRoot, allowNonCanonicalSourceRoot)) throw new Error('OpenClaw source path is not an allowed workspace root');
  const linkInfo = await lstat(sourceRoot).catch(() => null);
  if (!linkInfo?.isDirectory()) throw new Error('OpenClaw source path is not a directory');
  const realRoot = await realpath(sourceRoot);
  if (!isAllowedSourceRoot(realRoot, allowNonCanonicalSourceRoot)) throw new Error('OpenClaw source path is not an allowed workspace root');
  return realRoot;
}

function isAllowedSourceRoot(sourceRoot: string, allowNonCanonicalSourceRoot = false): boolean {
  const normalized = path.resolve(sourceRoot);
  const canonicalRoots = [
    path.resolve(homedir(), '.openclaw', 'workspace'),
    path.resolve(homedir(), 'openclaw-workspace'),
  ];
  if (canonicalRoots.includes(normalized)) return true;
  if (!allowNonCanonicalSourceRoot) return false;
  const base = path.basename(normalized);
  const parentBase = path.basename(path.dirname(normalized));
  return base === 'openclaw-workspace'
    || (base === 'workspace' && parentBase === '.openclaw');
}

async function discoverImportableFiles(
  sourceRoot: string,
  opts: {
    includePersonality: boolean;
    includeMemories: boolean;
    maxFiles: number;
    skipped: OpenClawMigrationSkipped[];
  },
): Promise<Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }>> {
  const files: Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }> = [];
  if (opts.includePersonality) {
    for (const [file, mapping] of Object.entries(ROOT_PERSONALITY_FILES)) {
      if (await isFile(path.join(sourceRoot, file))) files.push({ sourceRelPath: file, ...mapping });
    }
    files.push(...await discoverMarkdownTree(sourceRoot, 'skills', 'skill', 'procedural', opts.skipped));
  }
  if (opts.includeMemories) {
    files.push(...await discoverMarkdownTree(sourceRoot, 'memory', 'memory', 'episodic', opts.skipped));
  }
  return files
    .sort((a, b) => a.sourceRelPath.localeCompare(b.sourceRelPath))
    .slice(0, opts.maxFiles);
}

async function discoverMarkdownTree(
  sourceRoot: string,
  relDir: string,
  sourceKind: OpenClawMigrationEntry['sourceKind'],
  memoryType: MemoryType,
  skipped: OpenClawMigrationSkipped[],
): Promise<Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }>> {
  const root = path.join(sourceRoot, relDir);
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory()) return [];
  const results: Array<{ sourceRelPath: string; sourceKind: OpenClawMigrationEntry['sourceKind']; memoryType: MemoryType }> = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('~') || entry.name.includes('.backup')) {
        skipped.push({ sourceRelPath: path.relative(sourceRoot, path.join(dir, entry.name)), reason: 'denied_path' });
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(sourceRoot, full);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({ sourceRelPath: rel, sourceKind, memoryType });
      } else {
        skipped.push({ sourceRelPath: rel, reason: 'unsupported_file_type' });
      }
    }
  }
  await walk(root);
  return results;
}

async function isFile(filePath: string): Promise<boolean> {
  const info = await lstat(filePath).catch(() => null);
  return Boolean(info?.isFile());
}

function safeResolve(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('OpenClaw source path escaped source root');
  }
  return resolved;
}

async function readOpenClawTextFile(root: string, relPath: string): Promise<string> {
  const absolutePath = safeResolve(root, relPath);
  const linkInfo = await lstat(absolutePath);
  if (!linkInfo.isFile()) throw new Error('OpenClaw source path is not a regular file');
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolutePath)]);
  const relative = path.relative(realRoot, realFile);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('OpenClaw source path escaped source root');
  }
  return readFile(realFile, 'utf-8');
}

function normalizeContent(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function fingerprint(relPath: string, normalizedBody: string): string {
  return createHash('sha256').update(`${relPath}\n${normalizedBody}`).digest('hex');
}

function redactContent(value: string): { content: string; count: number } {
  let count = 0;
  const replace = (input: string, pattern: RegExp, replacement: string): string => input.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  let content = value;
  content = replace(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
  content = replace(content, /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
  content = replace(content, /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]{6,}["']?/gi, '$1=[REDACTED]');
  return { content, count };
}

function summarize(relPath: string, content: string): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0) ?? 'OpenClaw memory';
  return `${relPath}: ${firstLine.slice(0, 160)}`;
}
