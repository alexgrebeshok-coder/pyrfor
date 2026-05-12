#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

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
  dryRun: boolean;
  workspaceId?: string;
}

type CliCommand =
  | { kind: 'concept'; goal: string; options: ParsedOptions }
  | { kind: 'plan'; goal: string; options: ParsedOptions }
  | { kind: 'status'; conceptId: string; options: ParsedOptions }
  | { kind: 'abort'; conceptId: string; options: ParsedOptions }
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

  const options: ParsedOptions = {
    gatewayUrl: normalizeGatewayUrl(env['PYRFOR_GATEWAY_URL'] ?? DEFAULT_GATEWAY_URL),
    token: env['PYRFOR_GATEWAY_TOKEN'],
    json: false,
    dryRun: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
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
      options.workspaceId = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      options.workspaceId = arg.slice('--workspace='.length);
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }

  switch (command) {
    case 'concept':
      return { kind: 'concept', goal: requireJoinedPositionals(positionals, 'concept'), options };
    case 'plan':
      return { kind: 'plan', goal: requireJoinedPositionals(positionals, 'plan'), options: { ...options, dryRun: true } };
    case 'status':
      return { kind: 'status', conceptId: requireSinglePosition(positionals, 'status'), options };
    case 'abort':
      return { kind: 'abort', conceptId: requireSinglePosition(positionals, 'abort'), options };
    default:
      throw new CliUsageError(`Unknown command: ${command}`);
  }
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
  }
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
  }
  io.stdout.write(`${JSON.stringify(result)}\n`);
}

function helpText(): string {
  return `Pyrfor Universal Engine CLI

Usage:
  pyrfor concept "<goal>" [--gateway-url URL] [--workspace ID] [--dry-run] [--json]
  pyrfor plan "<goal>" [--gateway-url URL] [--workspace ID] [--json]
  pyrfor status <conceptId> [--gateway-url URL] [--json]
  pyrfor abort <conceptId> [--gateway-url URL] [--json]

Environment:
  PYRFOR_GATEWAY_URL    Gateway base URL (default: ${DEFAULT_GATEWAY_URL})
  PYRFOR_GATEWAY_TOKEN  Bearer token for protected gateways
`;
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

function requireSinglePosition(positionals: string[], command: string): string {
  if (positionals.length !== 1 || !positionals[0]?.trim()) throw new CliUsageError(`Expected exactly one conceptId for ${command}`);
  return positionals[0].trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
