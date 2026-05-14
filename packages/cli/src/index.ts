#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_SKILL_MD_BYTES } from '@pyrfor/engine/runtime/skill-importer';

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

export interface CliRuntime {
  argv: string[];
  env: NodeJS.ProcessEnv;
  io: CliIO;
  fetch: typeof fetch;
}

interface ParsedOptions {
  gatewayUrl: string;
  token?: string;
  json: boolean;
}

interface ConceptOptions extends ParsedOptions {
  dryRun: boolean;
  workspaceId?: string;
}

interface ConceptTraceOptions extends ParsedOptions {
  conceptId: string;
}

interface ConceptExportOptions extends ParsedOptions {
  conceptId: string;
  kind: 'incident-packet';
}

interface SkillImportOptions extends ParsedOptions {
  sourcePath: string;
}

interface SkillListOptions extends ParsedOptions {
  state?: string;
}

interface ToolRegistryListOptions extends ParsedOptions {
  status?: string;
  tag?: string;
}

interface MemorySearchOptions extends ParsedOptions {
  query: string;
  projectId?: string;
  limit?: number;
}

interface MemoryContinuityOptions extends ParsedOptions {
  projectId?: string;
}

interface MemoryReviewOptions extends ParsedOptions {
  memoryId: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

interface RunTimelineOptions extends ParsedOptions {
  runId: string;
}

interface OpenClawMigrationOptions extends ParsedOptions {
  action: 'dry-run' | 'import';
  sourcePath?: string;
  projectId?: string;
  includePersonality?: boolean;
  includeMemories?: boolean;
  maxFiles?: number;
}

interface OpenClawMigrationReportOptions extends ParsedOptions {
  projectId?: string;
}

interface OpenClawMigrationRollbackOptions extends ParsedOptions {
  resultArtifactId: string;
  expectedResultSha256: string;
}

interface OpenClawMigrationVerifyOptions extends ParsedOptions {
  resultArtifactId: string;
  expectedResultSha256: string;
  queryLimit?: number;
}

interface OpenClawMigrationAuditOptions extends ParsedOptions {
  projectId?: string;
  limit?: number;
}

interface ApprovalsListOptions extends ParsedOptions {}

interface ApprovalsDecisionOptions extends ParsedOptions {
  approvalId: string;
  decision: 'approve' | 'deny';
}

type CliCommand =
  | { kind: 'concept'; goal: string; options: ConceptOptions }
  | { kind: 'plan'; goal: string; options: ConceptOptions }
  | { kind: 'status'; conceptId: string; options: ParsedOptions }
  | { kind: 'abort'; conceptId: string; options: ParsedOptions }
  | { kind: 'conceptTrace'; options: ConceptTraceOptions }
  | { kind: 'conceptExport'; options: ConceptExportOptions }
  | { kind: 'skillsImport'; options: SkillImportOptions }
  | { kind: 'skillsList'; options: SkillListOptions }
  | { kind: 'toolsRegistryList'; options: ToolRegistryListOptions }
  | { kind: 'memorySearch'; options: MemorySearchOptions }
  | { kind: 'memoryContinuity'; options: MemoryContinuityOptions }
  | { kind: 'memoryReview'; options: MemoryReviewOptions }
  | { kind: 'runTimeline'; options: RunTimelineOptions }
  | { kind: 'migrateOpenClaw'; options: OpenClawMigrationOptions }
  | { kind: 'migrateReport'; options: OpenClawMigrationReportOptions }
  | { kind: 'migrateRollback'; options: OpenClawMigrationRollbackOptions }
  | { kind: 'migrateVerify'; options: OpenClawMigrationVerifyOptions }
  | { kind: 'migrateAudit'; options: OpenClawMigrationAuditOptions }
  | { kind: 'migrateQuarantine'; options: OpenClawMigrationAuditOptions }
  | { kind: 'approvalsList'; options: ApprovalsListOptions }
  | { kind: 'approvalsApprove'; options: ApprovalsDecisionOptions }
  | { kind: 'approvalsDeny'; options: ApprovalsDecisionOptions }
  | { kind: 'help' };

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18790';

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliCommand {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === '--help' || command === '-h' || command === 'help') return { kind: 'help' };
  if (command === 'migrate') return parseMigrateCommand(args, env);
  if (command === 'concept') return parseConceptCommand(args, env);
  if (command === 'skills') return parseSkillsCommand(args, env);
  if (command === 'tools') return parseToolsCommand(args, env);
  if (command === 'memory') return parseMemoryCommand(args, env);
  if (command === 'run') return parseRunCommand(args, env);
  if (command === 'approvals') return parseApprovalsCommand(args, env);

  const options: ParsedOptions = {
    gatewayUrl: normalizeGatewayUrl(env['PYRFOR_GATEWAY_URL'] ?? DEFAULT_GATEWAY_URL),
    token: env['PYRFOR_GATEWAY_TOKEN'],
    json: false,
  };
  const conceptOptions: Pick<ConceptOptions, 'dryRun' | 'workspaceId'> = { dryRun: false };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      conceptOptions.dryRun = true;
      continue;
    }
    if (arg === '--gateway-url' || arg === '--gateway') {
      options.gatewayUrl = normalizeGatewayUrl(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--gateway-url=')) {
      options.gatewayUrl = normalizeGatewayUrl(arg.slice('--gateway-url='.length));
      continue;
    }
    if (arg === '--token') {
      options.token = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length);
      continue;
    }
    if (arg === '--workspace' || arg === '--workspace-id') {
      conceptOptions.workspaceId = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      conceptOptions.workspaceId = arg.slice('--workspace='.length);
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }

  switch (command) {
    case 'plan':
      return { kind: 'plan', goal: requireJoinedPositionals(positionals, 'plan'), options: { ...options, ...conceptOptions, dryRun: true } };
    case 'status':
      return { kind: 'status', conceptId: requireSinglePosition(positionals, 'status', 'conceptId'), options };
    case 'abort':
      return { kind: 'abort', conceptId: requireSinglePosition(positionals, 'abort', 'conceptId'), options };
    default:
      throw new CliUsageError(`Unknown command: ${command}`);
  }
}

function parseConceptCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args[0];
  if (subcommand === 'trace') {
    args.shift();
    return { kind: 'conceptTrace', options: parseConceptIdOptions(args, env, 'concept trace') };
  }
  if (subcommand === 'export') {
    args.shift();
    return { kind: 'conceptExport', options: parseConceptExportOptions(args, env) };
  }
  if (subcommand === 'status') {
    args.shift();
    const parsed = parseConceptIdOptions(args, env, 'concept status');
    return { kind: 'status', conceptId: parsed.conceptId, options: parsed };
  }
  if (subcommand === 'abort') {
    args.shift();
    const parsed = parseConceptIdOptions(args, env, 'concept abort');
    return { kind: 'abort', conceptId: parsed.conceptId, options: parsed };
  }

  const options: ParsedOptions = baseOptions(env);
  const conceptOptions: Pick<ConceptOptions, 'dryRun' | 'workspaceId'> = { dryRun: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (parseBaseOption(options, args, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      conceptOptions.dryRun = true;
      continue;
    }
    if (arg === '--workspace' || arg === '--workspace-id') {
      conceptOptions.workspaceId = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      conceptOptions.workspaceId = arg.slice('--workspace='.length);
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }
  return { kind: 'concept', goal: requireJoinedPositionals(positionals, 'concept'), options: { ...options, ...conceptOptions } };
}

function parseConceptIdOptions(argv: string[], env: NodeJS.ProcessEnv, command: string): ConceptTraceOptions {
  const options = baseOptions(env) as ConceptTraceOptions;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }
  options.conceptId = requireSinglePosition(positionals, command, 'conceptId');
  return options;
}

function parseConceptExportOptions(argv: string[], env: NodeJS.ProcessEnv): ConceptExportOptions {
  const options = baseOptions(env) as ConceptExportOptions;
  const positionals: string[] = [];
  let incidentPacket = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--incident-packet') {
      incidentPacket = true;
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }
  if (!incidentPacket) throw new CliUsageError('Missing --incident-packet for concept export');
  options.conceptId = requireSinglePosition(positionals, 'concept export', 'conceptId');
  options.kind = 'incident-packet';
  return options;
}

function parseSkillsCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (subcommand === 'import') {
    const options = baseOptions(env) as SkillImportOptions;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
      positionals.push(arg);
    }
    options.sourcePath = requireSinglePosition(positionals, 'skills import', 'sourcePath');
    return { kind: 'skillsImport', options };
  }
  if (subcommand === 'list') {
    const options = baseOptions(env) as SkillListOptions;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg === '--state' || arg === '--status') {
        options.state = requireValue(args, ++i, arg);
        continue;
      }
      if (arg.startsWith('--state=')) {
        options.state = arg.slice('--state='.length);
        continue;
      }
      if (arg.startsWith('--status=')) {
        options.state = arg.slice('--status='.length);
        continue;
      }
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    return { kind: 'skillsList', options };
  }
  if (subcommand === 'test' || subcommand === 'approve') {
    throw new CliUsageError(`skills ${subcommand} is not available until validation and approval execution are wired`);
  }
  throw new CliUsageError(`Unknown skills subcommand: ${subcommand ?? ''}`.trim());
}

function parseToolsCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (subcommand !== 'registry' || args.shift() !== 'list') {
    throw new CliUsageError('Expected tools registry list');
  }
  const options = baseOptions(env) as ToolRegistryListOptions;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (parseBaseOption(options, args, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--status' || arg === '--state') {
      options.status = requireValue(args, ++i, arg);
      continue;
    }
    if (arg === '--tag') {
      options.tag = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--status=')) {
      options.status = arg.slice('--status='.length);
      continue;
    }
    if (arg.startsWith('--state=')) {
      options.status = arg.slice('--state='.length);
      continue;
    }
    if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length);
      continue;
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  return { kind: 'toolsRegistryList', options };
}

function parseMemoryCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (subcommand === 'search') {
    const options = baseOptions(env) as MemorySearchOptions;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg === '--project') {
        options.projectId = requireValue(args, ++i, arg);
        continue;
      }
      if (arg === '--limit') {
        options.limit = parsePositiveInteger(requireValue(args, ++i, arg), '--limit');
        continue;
      }
      if (arg.startsWith('--project=')) {
        options.projectId = arg.slice('--project='.length);
        continue;
      }
      if (arg.startsWith('--limit=')) {
        options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
        continue;
      }
      if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
      positionals.push(arg);
    }
    options.query = requireJoinedPositionals(positionals, 'memory search');
    return { kind: 'memorySearch', options };
  }
  if (subcommand === 'continuity') {
    const options = baseOptions(env) as MemoryContinuityOptions;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg === '--project') {
        options.projectId = requireValue(args, ++i, arg);
        continue;
      }
      if (arg.startsWith('--project=')) {
        options.projectId = arg.slice('--project='.length);
        continue;
      }
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    return { kind: 'memoryContinuity', options };
  }
  if (subcommand === 'review') {
    const decision = args.shift();
    if (decision !== 'approve' && decision !== 'reject') {
      throw new CliUsageError(`Unknown memory review action: ${decision ?? '(missing)'}`);
    }
    const options = baseOptions(env) as MemoryReviewOptions;
    options.decision = decision;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg === '--reason') {
        options.reason = requireValue(args, ++i, arg);
        continue;
      }
      if (arg.startsWith('--reason=')) {
        options.reason = arg.slice('--reason='.length);
        continue;
      }
      if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
      positionals.push(arg);
    }
    options.memoryId = requireSinglePosition(positionals, `memory review ${decision}`, 'memoryId');
    return { kind: 'memoryReview', options };
  }
  throw new CliUsageError(`Unknown memory subcommand: ${subcommand ?? ''}`.trim());
}

function parseApprovalsCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (subcommand === 'list') {
    const options = baseOptions(env) as ApprovalsListOptions;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    return { kind: 'approvalsList', options };
  }
  if (subcommand === 'approve' || subcommand === 'deny') {
    const options = baseOptions(env) as ApprovalsDecisionOptions;
    options.decision = subcommand;
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (parseBaseOption(options, args, i)) {
        if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
        continue;
      }
      if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
      positionals.push(arg);
    }
    options.approvalId = requireSinglePosition(positionals, `approvals ${subcommand}`, 'approvalId');
    return { kind: subcommand === 'approve' ? 'approvalsApprove' : 'approvalsDeny', options };
  }
  throw new CliUsageError(`Unknown approvals subcommand: ${subcommand ?? ''}`.trim());
}

function parseRunCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (subcommand !== 'timeline') throw new CliUsageError(`Unknown run subcommand: ${subcommand ?? ''}`.trim());
  const options = baseOptions(env) as RunTimelineOptions;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (parseBaseOption(options, args, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }
  options.runId = requireSinglePosition(positionals, 'run timeline', 'runId');
  return { kind: 'runTimeline', options };
}

function parseMigrateCommand(args: string[], env: NodeJS.ProcessEnv): CliCommand {
  const subcommand = args.shift();
  if (!subcommand) throw new CliUsageError('Missing migrate subcommand');
  if (subcommand === 'openclaw') return parseOpenClawMigration(args, env);
  if (subcommand === 'report') return parseOpenClawMigrationReport(args, env);
  if (subcommand === 'rollback') return parseOpenClawMigrationRollback(args, env);
  if (subcommand === 'verify') return parseOpenClawMigrationVerify(args, env);
  if (subcommand === 'audit') return parseOpenClawMigrationAudit(args, env, 'migrateAudit');
  if (subcommand === 'quarantine') return parseOpenClawMigrationAudit(args, env, 'migrateQuarantine');
  throw new CliUsageError(`Unknown migrate subcommand: ${subcommand}`);
}

function parseOpenClawMigration(argv: string[], env: NodeJS.ProcessEnv): CliCommand {
  const options: OpenClawMigrationOptions = {
    ...baseOptions(env),
    action: 'dry-run',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.action = 'dry-run';
      continue;
    }
    if (arg === '--import') {
      options.action = 'import';
      continue;
    }
    if (arg === '--from') {
      options.sourcePath = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--from=')) {
      options.sourcePath = arg.slice('--from='.length);
      continue;
    }
    if (arg === '--project' || arg === '--project-id') {
      options.projectId = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--project=')) {
      options.projectId = arg.slice('--project='.length);
      continue;
    }
    if (arg === '--max-files') {
      options.maxFiles = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith('--max-files=')) {
      options.maxFiles = parsePositiveInteger(arg.slice('--max-files='.length), '--max-files');
      continue;
    }
    if (arg === '--no-personality') {
      options.includePersonality = false;
      continue;
    }
    if (arg === '--no-memories') {
      options.includeMemories = false;
      continue;
    }
    if (arg === '--shadow' || arg === '--rollback') {
      throw new CliUsageError(`${arg} is planned for a later R1 slice; use --dry-run or --import now`);
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  return { kind: 'migrateOpenClaw', options };
}

function parseOpenClawMigrationReport(argv: string[], env: NodeJS.ProcessEnv): CliCommand {
  const options: OpenClawMigrationReportOptions = baseOptions(env);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--project' || arg === '--project-id') {
      options.projectId = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--project=')) {
      options.projectId = arg.slice('--project='.length);
      continue;
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  return { kind: 'migrateReport', options };
}

function parseOpenClawMigrationRollback(argv: string[], env: NodeJS.ProcessEnv): CliCommand {
  const options = baseOptions(env) as OpenClawMigrationRollbackOptions;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--result-artifact-id') {
      options.resultArtifactId = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--result-artifact-id=')) {
      options.resultArtifactId = arg.slice('--result-artifact-id='.length);
      continue;
    }
    if (arg === '--expected-sha256' || arg === '--expected-result-sha256') {
      options.expectedResultSha256 = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--expected-sha256=')) {
      options.expectedResultSha256 = arg.slice('--expected-sha256='.length);
      continue;
    }
    if (arg.startsWith('--expected-result-sha256=')) {
      options.expectedResultSha256 = arg.slice('--expected-result-sha256='.length);
      continue;
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  if (!options.resultArtifactId) throw new CliUsageError('Missing --result-artifact-id for migrate rollback');
  if (!options.expectedResultSha256) throw new CliUsageError('Missing --expected-sha256 for migrate rollback');
  return { kind: 'migrateRollback', options };
}

function parseOpenClawMigrationVerify(argv: string[], env: NodeJS.ProcessEnv): CliCommand {
  const options = baseOptions(env) as OpenClawMigrationVerifyOptions;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--result-artifact-id') {
      options.resultArtifactId = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--result-artifact-id=')) {
      options.resultArtifactId = arg.slice('--result-artifact-id='.length);
      continue;
    }
    if (arg === '--expected-sha256' || arg === '--expected-result-sha256') {
      options.expectedResultSha256 = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--expected-sha256=')) {
      options.expectedResultSha256 = arg.slice('--expected-sha256='.length);
      continue;
    }
    if (arg.startsWith('--expected-result-sha256=')) {
      options.expectedResultSha256 = arg.slice('--expected-result-sha256='.length);
      continue;
    }
    if (arg === '--query-limit') {
      options.queryLimit = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith('--query-limit=')) {
      options.queryLimit = parsePositiveInteger(arg.slice('--query-limit='.length), '--query-limit');
      continue;
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  if (!options.resultArtifactId) throw new CliUsageError('Missing --result-artifact-id for migrate verify');
  if (!options.expectedResultSha256) throw new CliUsageError('Missing --expected-sha256 for migrate verify');
  return { kind: 'migrateVerify', options };
}

function parseOpenClawMigrationAudit(
  argv: string[],
  env: NodeJS.ProcessEnv,
  kind: 'migrateAudit' | 'migrateQuarantine',
): CliCommand {
  const options: OpenClawMigrationAuditOptions = baseOptions(env);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (parseBaseOption(options, argv, i)) {
      if (arg === '--gateway-url' || arg === '--gateway' || arg === '--token') i += 1;
      continue;
    }
    if (arg === '--project' || arg === '--project-id') {
      options.projectId = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith('--project=')) {
      options.projectId = arg.slice('--project='.length);
      continue;
    }
    if (arg === '--limit') {
      options.limit = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    throw new CliUsageError(`Unknown option: ${arg}`);
  }
  return kind === 'migrateAudit' ? { kind, options } : { kind, options };
}

function baseOptions(env: NodeJS.ProcessEnv): ParsedOptions {
  return {
    gatewayUrl: normalizeGatewayUrl(env['PYRFOR_GATEWAY_URL'] ?? DEFAULT_GATEWAY_URL),
    token: env['PYRFOR_GATEWAY_TOKEN'],
    json: false,
  };
}

function parseBaseOption(options: ParsedOptions, args: string[], index: number): boolean {
  const arg = args[index]!;
  if (arg === '--json') {
    options.json = true;
    return true;
  }
  if (arg === '--gateway-url' || arg === '--gateway') {
    options.gatewayUrl = normalizeGatewayUrl(requireValue(args, index + 1, arg));
    return true;
  }
  if (arg.startsWith('--gateway-url=')) {
    options.gatewayUrl = normalizeGatewayUrl(arg.slice('--gateway-url='.length));
    return true;
  }
  if (arg === '--token') {
    options.token = requireValue(args, index + 1, arg);
    return true;
  }
  if (arg.startsWith('--token=')) {
    options.token = arg.slice('--token='.length);
    return true;
  }
  return false;
}

export async function runCli(runtime: Partial<CliRuntime> = {}): Promise<number> {
  const io = runtime.io ?? { stdout: process.stdout, stderr: process.stderr };
  const env = runtime.env ?? process.env;
  const fetchImpl = runtime.fetch ?? fetch;

  try {
    const command = parseCliArgs(runtime.argv ?? process.argv.slice(2), env);
    if (command.kind === 'help') {
      io.stdout.write(helpText());
      return 0;
    }
    const result = await executeCommand(command, fetchImpl);
    writeCommandResult(io, command, result);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`${message}\n`);
    if (err instanceof CliUsageError) io.stderr.write(helpText());
    return 1;
  }
}

async function executeCommand(command: Exclude<CliCommand, { kind: 'help' }>, fetchImpl: typeof fetch): Promise<unknown> {
  switch (command.kind) {
    case 'concept':
      return requestJson(fetchImpl, command.options, '/api/concepts', {
        method: 'POST',
        body: {
          goal: command.goal,
          ...(command.options.workspaceId ? { workspaceId: command.options.workspaceId } : {}),
          ...(command.options.dryRun ? { dryRun: true } : {}),
        },
      });
    case 'plan':
      return requestJson(fetchImpl, command.options, '/api/concepts', {
        method: 'POST',
        body: {
          goal: command.goal,
          ...(command.options.workspaceId ? { workspaceId: command.options.workspaceId } : {}),
          dryRun: true,
        },
      });
    case 'status':
      return requestJson(fetchImpl, command.options, `/api/concepts/${encodeURIComponent(command.conceptId)}`, { method: 'GET' });
    case 'abort':
      return requestJson(fetchImpl, command.options, `/api/concepts/${encodeURIComponent(command.conceptId)}`, { method: 'DELETE' });
    case 'conceptTrace':
      return requestJson(fetchImpl, command.options, `/api/concepts/${encodeURIComponent(command.options.conceptId)}/trace`, { method: 'GET' });
    case 'conceptExport':
      return requestJson(fetchImpl, command.options, `/api/concepts/${encodeURIComponent(command.options.conceptId)}/export?kind=${encodeURIComponent(command.options.kind)}`, { method: 'GET' });
    case 'skillsImport':
      return requestJson(fetchImpl, command.options, '/api/skills/import', {
        method: 'POST',
        body: readSkillImportBody(command.options.sourcePath),
      });
    case 'skillsList':
      return requestJson(fetchImpl, command.options, skillListPath(command.options), { method: 'GET' });
    case 'toolsRegistryList':
      return requestJson(fetchImpl, command.options, toolRegistryListPath(command.options), { method: 'GET' });
    case 'memorySearch':
      return requestJson(fetchImpl, command.options, memorySearchPath(command.options), { method: 'GET' });
    case 'memoryContinuity':
      return requestJson(fetchImpl, command.options, memoryContinuityPath(command.options), { method: 'GET' });
    case 'memoryReview':
      return requestJson(fetchImpl, command.options, `/api/memory/${encodeURIComponent(command.options.memoryId)}/review`, {
        method: 'POST',
        body: {
          decision: command.options.decision,
          ...(command.options.reason ? { reason: command.options.reason } : {}),
        },
      });
    case 'runTimeline':
      return requestJson(fetchImpl, command.options, `/api/runs/${encodeURIComponent(command.options.runId)}/timeline`, { method: 'GET' });
    case 'migrateOpenClaw':
      return migrateOpenClaw(fetchImpl, command.options);
    case 'migrateReport':
      return requestJson(fetchImpl, command.options, migrationReportPath(command.options), { method: 'GET' });
    case 'migrateRollback':
      return requestJson(fetchImpl, command.options, '/api/memory/openclaw-rollback', {
        method: 'POST',
        body: {
          resultArtifactId: command.options.resultArtifactId,
          expectedResultSha256: command.options.expectedResultSha256,
        },
      });
    case 'migrateVerify':
      return requestJson(fetchImpl, command.options, '/api/memory/openclaw-verify', {
        method: 'POST',
        body: {
          resultArtifactId: command.options.resultArtifactId,
          expectedResultSha256: command.options.expectedResultSha256,
          ...(command.options.queryLimit !== undefined ? { queryLimit: command.options.queryLimit } : {}),
        },
      });
    case 'migrateAudit':
      return requestJson(fetchImpl, command.options, migrationAuditPath('/api/memory/openclaw-audit', command.options), { method: 'GET' });
    case 'migrateQuarantine':
      return requestJson(fetchImpl, command.options, migrationAuditPath('/api/memory/openclaw-quarantine', command.options), { method: 'GET' });
    case 'approvalsList':
      return requestJson(fetchImpl, command.options, '/api/approvals/pending', { method: 'GET' });
    case 'approvalsApprove':
    case 'approvalsDeny':
      return requestJson(fetchImpl, command.options, `/api/approvals/${encodeURIComponent(command.options.approvalId)}/decision`, {
        method: 'POST',
        body: { decision: command.options.decision },
      });
  }
}

function readSkillImportBody(inputPath: string): { content: string; sourceLabel: string } {
  const resolved = path.resolve(inputPath);
  const filePath = statSync(resolved).isDirectory() ? path.join(resolved, 'SKILL.md') : resolved;
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new CliUsageError('skills import expects a SKILL.md file or directory containing SKILL.md');
  if (stat.size > MAX_SKILL_MD_BYTES) throw new CliUsageError('SKILL.md is too large to import');
  return {
    content: readFileSync(filePath, 'utf8'),
    sourceLabel: path.basename(filePath),
  };
}

function skillListPath(options: SkillListOptions): string {
  const params = new URLSearchParams();
  params.set('tag', 'skill-import');
  if (options.state) params.set('status', options.state);
  const query = params.toString();
  return `/api/tools/registry${query ? `?${query}` : ''}`;
}

function toolRegistryListPath(options: ToolRegistryListOptions): string {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.tag) params.set('tag', options.tag);
  const query = params.toString();
  return `/api/tools/registry${query ? `?${query}` : ''}`;
}

function memorySearchPath(options: MemorySearchOptions): string {
  const params = new URLSearchParams();
  params.set('q', options.query);
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  return `/api/memory/search?${params.toString()}`;
}

function memoryContinuityPath(options: MemoryContinuityOptions): string {
  const params = new URLSearchParams();
  if (options.projectId) params.set('projectId', options.projectId);
  const query = params.toString();
  return `/api/memory/continuity${query ? `?${query}` : ''}`;
}

async function migrateOpenClaw(fetchImpl: typeof fetch, options: OpenClawMigrationOptions): Promise<unknown> {
  const preview = await requestJson(fetchImpl, options, '/api/memory/openclaw-import-report', {
    method: 'POST',
    body: {
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.includePersonality !== undefined ? { includePersonality: options.includePersonality } : {}),
      ...(options.includeMemories !== undefined ? { includeMemories: options.includeMemories } : {}),
      ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
    },
  });
  if (options.action === 'dry-run') return { status: 'dry-run', preview };
  if (!isRecord(preview) || !isRecord(preview.artifact)) throw new Error('OpenClaw migration preview response missing artifact');
  const artifact = preview.artifact;
  if (typeof artifact.id !== 'string' || typeof artifact.sha256 !== 'string') {
    throw new Error('OpenClaw migration preview response missing report artifact hash');
  }
  const imported = await requestJson(fetchImpl, options, '/api/memory/openclaw-import', {
    method: 'POST',
    body: {
      reportArtifactId: artifact.id,
      expectedReportSha256: artifact.sha256,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
  });
  return { status: 'imported', preview, imported };
}

async function requestJson(
  fetchImpl: typeof fetch,
  options: ParsedOptions,
  path: string,
  request: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetchImpl(`${options.gatewayUrl}${path}`, {
    method: request.method,
    headers,
    ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : response.statusText;
    throw new Error(`Gateway request failed (${response.status}): ${error}`);
  }
  return body;
}

function writeCommandResult(io: CliIO, command: Exclude<CliCommand, { kind: 'help' }>, result: unknown): void {
  if (command.options.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (isRecord(result)) {
    if (command.kind === 'concept' || command.kind === 'plan') {
      io.stdout.write(`Concept ${String(result.conceptId ?? 'unknown')} queued (${String(result.status ?? 'unknown')})\n`);
      return;
    }
    if (command.kind === 'status') {
      io.stdout.write(`Concept ${String(result.conceptId ?? command.conceptId)}: ${String(result.status ?? 'unknown')}\n`);
      return;
    }
    if (command.kind === 'abort') {
      io.stdout.write(`Concept ${String(result.conceptId ?? command.conceptId)} abort requested\n`);
      return;
    }
    if (command.kind === 'conceptTrace') {
      writeConceptTrace(io, result);
      return;
    }
    if (command.kind === 'conceptExport') {
      writeConceptExport(io, result);
      return;
    }
    if (command.kind === 'skillsImport') {
      writeSkillImport(io, result);
      return;
    }
    if (command.kind === 'skillsList' || command.kind === 'toolsRegistryList') {
      writeToolRegistry(io, result);
      return;
    }
    if (command.kind === 'memorySearch') {
      writeMemorySearch(io, result);
      return;
    }
    if (command.kind === 'memoryContinuity') {
      writeMemoryContinuity(io, result);
      return;
    }
    if (command.kind === 'memoryReview') {
      writeMemoryReview(io, result);
      return;
    }
    if (command.kind === 'runTimeline') {
      writeRunTimeline(io, result);
      return;
    }
    if (command.kind === 'migrateOpenClaw') {
      writeMigrationResult(io, command, result);
      return;
    }
    if (command.kind === 'migrateReport') {
      writeMigrationReport(io, result);
      return;
    }
    if (command.kind === 'migrateRollback') {
      writeMigrationRollback(io, result);
      return;
    }
    if (command.kind === 'migrateVerify') {
      writeMigrationVerify(io, result);
      return;
    }
    if (command.kind === 'migrateAudit') {
      writeMigrationAudit(io, result);
      return;
    }
    if (command.kind === 'migrateQuarantine') {
      writeMigrationQuarantine(io, result);
      return;
    }
    if (command.kind === 'approvalsList') {
      writeApprovalsList(io, result);
      return;
    }
    if (command.kind === 'approvalsApprove' || command.kind === 'approvalsDeny') {
      writeApprovalsDecision(io, command, result);
      return;
    }
  }
  io.stdout.write(`${JSON.stringify(result)}\n`);
}

function writeConceptTrace(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const concept = isRecord(result.concept) ? result.concept : {};
  const phases = Array.isArray(result.phases) ? result.phases : [];
  const events = Array.isArray(result.events) ? result.events : [];
  const artifactIds = Array.isArray(result.artifactIds) ? result.artifactIds : [];
  io.stdout.write(`Concept ${String(concept.conceptId ?? 'unknown')} trace: `
    + `${String(concept.status ?? 'unknown')} status, ${phases.length} phases, `
    + `${events.length} ledger events, ${artifactIds.length} artifacts\n`);
}

function writeConceptExport(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const summary = isRecord(result.summary) ? result.summary : {};
  io.stdout.write(`Concept ${String(summary.conceptId ?? 'unknown')} incident packet: `
    + `${String(summary.status ?? 'unknown')} status, ${String(summary.eventCount ?? 0)} events, `
    + `${String(summary.artifactCount ?? 0)} artifacts\n`);
}

function writeSkillImport(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const entry = isRecord(result.entry) ? result.entry : {};
  io.stdout.write(`Skill ${String(entry.name ?? 'unknown')} imported as ${String(entry.status ?? 'unknown')} (${String(entry.id ?? 'unknown')})\n`);
}

function writeToolRegistry(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const tools = Array.isArray(result.tools) ? result.tools : [];
  io.stdout.write(`Tool registry: ${tools.length} tools\n`);
  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    const quality = isRecord(tool.quality) ? tool.quality : {};
    io.stdout.write(`- ${String(tool.name ?? 'unknown')} [${String(tool.status ?? 'unknown')}] `
      + `${String(tool.kind ?? 'tool')} provenance=${String(quality.provenance ?? 'unknown')} `
      + `trust=${String(quality.provenanceTrust ?? 'unknown')}\n`);
  }
}

function writeMemorySearch(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const results = Array.isArray(result.results) ? result.results : [];
  io.stdout.write(`Memory search: ${results.length} hits\n`);
  for (const hit of results) {
    if (!isRecord(hit)) continue;
    const suffix = [
      Array.isArray(hit.provenanceKinds) && hit.provenanceKinds.length > 0 ? `provenance=${hit.provenanceKinds.join('|')}` : '',
      typeof hit.importedFrom === 'string' ? `from=${hit.importedFrom}` : '',
      typeof hit.correctionKind === 'string' ? `correction=${hit.correctionKind}` : '',
    ].filter(Boolean).join(' ');
    io.stdout.write(`- ${String(hit.summary ?? hit.id ?? 'memory')} `
      + `[${String(hit.memoryType ?? 'unknown')}] `
      + `import=${String(hit.importState ?? 'native')} `
      + `approval=${String(hit.approvalState ?? 'approved')} `
      + `planner=${String(hit.plannerEligible ?? true)}`
      + `${suffix ? ` ${suffix}` : ''}\n`);
  }
}

function writeMemoryContinuity(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  io.stdout.write(`Memory continuity: ${warnings.length} warnings\n`);
  if (warnings.length > 0) io.stdout.write(`Warnings: ${warnings.join(', ')}\n`);
}

function writeMemoryReview(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const memory = isRecord(result.memory) ? result.memory : {};
  io.stdout.write(`Memory ${String(memory.id ?? 'unknown')} review: `
    + `${String(result.decision ?? 'unknown')} -> `
    + `import=${String(memory.importState ?? 'native')} `
    + `approval=${String(memory.approvalState ?? 'approved')} `
    + `planner=${String(memory.plannerEligible ?? true)}\n`);
}

function writeRunTimeline(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const run = isRecord(result.run) ? result.run : {};
  const summary = isRecord(result.summary) ? result.summary : {};
  const replay = isRecord(result.replay) ? result.replay : {};
  io.stdout.write(`Run ${String(run.run_id ?? 'unknown')} timeline: `
    + `${String(run.status ?? 'unknown')} status, ${String(summary.eventCount ?? 0)} events, `
    + `context=${String(summary.hasContextPack ?? false)}, delivery=${String(summary.hasDeliveryEvidence ?? false)}, `
    + `replay=${String(replay.available ?? false)}\n`);
}

function writeMigrationResult(io: CliIO, command: Extract<CliCommand, { kind: 'migrateOpenClaw' }>, result: Record<string, unknown>): void {
  const preview = isRecord(result.preview) ? result.preview : {};
  const report = isRecord(preview.report) ? preview.report : {};
  const counts = isRecord(report.counts) ? report.counts : {};
  const artifact = isRecord(preview.artifact) ? preview.artifact : {};
  const summary = `OpenClaw migration ${command.options.action === 'import' ? 'import' : 'dry-run'}: `
    + `${String(counts.importable ?? 0)} importable, ${String(counts.skipped ?? 0)} skipped, `
    + `${String(counts.redactions ?? 0)} redactions`;
  if (command.options.action === 'dry-run') {
    io.stdout.write(`${summary}\nReport artifact: ${String(artifact.id ?? 'unknown')} sha256=${String(artifact.sha256 ?? 'unknown')}\n`);
    return;
  }
  const imported = isRecord(result.imported) ? result.imported : {};
  const importResult = isRecord(imported.result) ? imported.result : {};
  io.stdout.write(`${summary}\nMigration ID: ${String(importResult.migrationId ?? 'unknown')}\nImported memories: ${String(importResult.imported ?? 0)}; skipped during import: ${String(importResult.skipped ?? 0)}\n`);
}

function writeMigrationReport(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const report = isRecord(result.report) ? result.report : {};
  const counts = isRecord(report.counts) ? report.counts : {};
  const artifact = isRecord(result.artifact) ? result.artifact : {};
  io.stdout.write(`Latest OpenClaw migration report: ${String(counts.importable ?? 0)} importable, `
    + `${String(counts.skipped ?? 0)} skipped, artifact ${String(artifact.id ?? 'unknown')}\n`);
}

function writeMigrationRollback(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const rollback = isRecord(result.result) ? result.result : {};
  io.stdout.write(`OpenClaw migration rollback ${String(rollback.migrationId ?? 'unknown')}: `
    + `${String(rollback.revoked ?? 0)} revoked, ${String(rollback.skippedIds && Array.isArray(rollback.skippedIds) ? rollback.skippedIds.length : 0)} skipped, `
    + `${String(rollback.missingIds && Array.isArray(rollback.missingIds) ? rollback.missingIds.length : 0)} missing\n`);
}

function writeMigrationVerify(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const verification = isRecord(result.result) ? result.result : {};
  io.stdout.write(`OpenClaw migration verify ${String(verification.migrationId ?? 'unknown')}: `
    + `${String(verification.foundCount ?? 0)} found, ${String(verification.missCount ?? 0)} missed, `
    + `${String(verification.searchAttemptsFailed ?? 0)} search failures\n`);
}

function writeMigrationAudit(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const migrations = Array.isArray(result.migrations) ? result.migrations : [];
  const quarantineCandidates = Array.isArray(result.quarantineCandidates) ? result.quarantineCandidates : [];
  const searchFailures = Array.isArray(result.searchFailures) ? result.searchFailures : [];
  io.stdout.write(`OpenClaw migration audit: ${migrations.length} migrations, `
    + `${quarantineCandidates.length} quarantine candidates, ${searchFailures.length} search failures\n`);
}

function writeMigrationQuarantine(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  io.stdout.write(`OpenClaw migration quarantine: ${String(result.candidateCount ?? 0)} candidates, `
    + `${String(result.searchFailureCount ?? 0)} search failures across ${String(result.sourceMigrationCount ?? 0)} migrations\n`);
}

function writeApprovalsList(io: CliIO, result: unknown): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const approvals = Array.isArray(result.approvals) ? result.approvals : [];
  if (approvals.length === 0) {
    io.stdout.write('No pending approvals.\n');
    return;
  }
  io.stdout.write(`Pending approvals: ${approvals.length}\n`);
  for (const approval of approvals) {
    if (!isRecord(approval)) continue;
    io.stdout.write(`[${String(approval.id ?? 'unknown')}] ${String(approval.toolName ?? 'unknown')}: ${String(approval.summary ?? '')}\n`);
  }
}

function writeApprovalsDecision(
  io: CliIO,
  command: Extract<CliCommand, { kind: 'approvalsApprove' | 'approvalsDeny' }>,
  result: unknown,
): void {
  if (!isRecord(result)) {
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  io.stdout.write(`Approval ${command.options.approvalId}: ${String(result.decision ?? command.options.decision)} recorded\n`);
}

function helpText(): string {
  return `Pyrfor Universal Engine CLI

Usage:
  pyrfor concept "<goal>" [--gateway-url URL] [--workspace ID] [--dry-run] [--json]
  pyrfor concept trace <conceptId> [--gateway-url URL] [--json]
  pyrfor concept export <conceptId> --incident-packet [--gateway-url URL] [--json]
  pyrfor concept status <conceptId> [--gateway-url URL] [--json]
  pyrfor concept abort <conceptId> [--gateway-url URL] [--json]
  pyrfor plan "<goal>" [--gateway-url URL] [--workspace ID] [--json]
  pyrfor status <conceptId> [--gateway-url URL] [--json]
  pyrfor abort <conceptId> [--gateway-url URL] [--json]
  pyrfor skills import <path-to-SKILL.md-or-dir> [--gateway-url URL] [--json]
  pyrfor skills list [--state pending_validation] [--gateway-url URL] [--json]
  pyrfor tools registry list [--status pending_validation] [--tag skill-import] [--gateway-url URL] [--json]
  pyrfor memory search "<query>" [--project ID] [--limit N] [--gateway-url URL] [--json]
  pyrfor memory continuity [--project ID] [--gateway-url URL] [--json]
  pyrfor memory review <approve|reject> <memoryId> [--reason TEXT] [--gateway-url URL] [--json]
  pyrfor run timeline <runId> [--gateway-url URL] [--json]
  pyrfor migrate openclaw [--from PATH] [--dry-run|--import] [--project ID] [--max-files N] [--json]
  pyrfor migrate report [--project ID] [--json]
  pyrfor migrate rollback --result-artifact-id ID --expected-sha256 SHA [--json]
  pyrfor migrate verify --result-artifact-id ID --expected-sha256 SHA [--query-limit N] [--json]
  pyrfor migrate audit [--project ID] [--limit N] [--json]
  pyrfor migrate quarantine [--project ID] [--limit N] [--json]
  pyrfor approvals list [--gateway-url URL] [--json]
  pyrfor approvals approve <approvalId> [--gateway-url URL] [--json]
  pyrfor approvals deny <approvalId> [--gateway-url URL] [--json]

Environment:
  PYRFOR_GATEWAY_URL    Gateway base URL (default: ${DEFAULT_GATEWAY_URL})
  PYRFOR_GATEWAY_TOKEN  Bearer token for protected gateways
`;
}

function migrationReportPath(options: OpenClawMigrationReportOptions): string {
  const query = options.projectId ? `?projectId=${encodeURIComponent(options.projectId)}` : '';
  return `/api/memory/openclaw-import-report${query}`;
}

function migrationAuditPath(basePath: string, options: OpenClawMigrationAuditOptions): string {
  const params = new URLSearchParams();
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CliUsageError('Gateway URL cannot be empty');
  return trimmed.replace(/\/+$/, '');
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) throw new CliUsageError(`Missing value for ${option}`);
  return value;
}

function requireJoinedPositionals(positionals: string[], command: string): string {
  const value = positionals.join(' ').trim();
  if (!value) throw new CliUsageError(`Missing goal for ${command}`);
  return value;
}

function requireSinglePosition(positionals: string[], command: string, label: string): string {
  if (positionals.length !== 1 || !positionals[0]?.trim()) throw new CliUsageError(`Expected exactly one ${label} for ${command}`);
  return positionals[0].trim();
}

function parsePositiveInteger(raw: string, option: string): number {
  if (!/^[1-9]\d*$/.test(raw)) throw new CliUsageError(`${option} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new CliUsageError(`${option} must be a positive integer`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
