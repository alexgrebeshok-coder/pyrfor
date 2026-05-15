import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type ToolKind = 'script' | 'api_client' | 'mcp_tool' | 'wasm_module' | 'skill';
export type ToolStatus = 'pending_validation' | 'sandboxed_experiment' | 'vetted' | 'trusted' | 'core' | 'retired';
export type SandboxTier = 'wasm' | 'container_no_net' | 'container_net_allowlist' | 'container_full' | 'host';

export interface ToolCapabilityManifest {
  description: string;
  triggers: string[];
  inputSchema: object;
  outputSchema: object;
  declaredEffects: Array<'fs.read' | 'fs.write' | 'net.out' | 'net.in' | 'process.spawn' | 'env.read' | 'time'>;
  requiredTrustTier: ToolStatus;
  requiredSandboxTier: SandboxTier;
  egressAllowlist?: string[];
  fsScope?: string[];
  perCallBudget?: { tokensUSD?: number; wallMs?: number; egressKB?: number };
}

export interface ToolTrustTransition {
  at: string;
  from: ToolStatus;
  to: ToolStatus;
  reason: string;
  runId?: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  kind: ToolKind;
  status: ToolStatus;
  capability: ToolCapabilityManifest;
  implPath: string;
  contentHash: string;
  signature?: string;
  artifactId: string;
  testSuiteArtifactId: string;
  lastTestResultArtifactId?: string;
  forgedByConceptId?: string;
  parentToolId?: string;
  version: number;
  trustHistory: ToolTrustTransition[];
  failureScore: number;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  tags: string[];
}

export type RegisterToolInput = Omit<
  RegistryEntry,
  'id' | 'status' | 'version' | 'trustHistory' | 'failureScore' | 'createdAt' | 'updatedAt' | 'retiredAt'
> & {
  status?: ToolStatus;
  failureScore?: number;
  trustHistory?: ToolTrustTransition[];
};

export interface ToolRegistryQuery {
  kind?: ToolKind;
  status?: ToolStatus | 'active';
  q?: string;
  tags?: string[];
  limit?: number;
}

export interface ToolRegistry {
  register(input: RegisterToolInput): RegistryEntry;
  registerWithDisposition(input: RegisterToolInput): { entry: RegistryEntry; created: boolean };
  find(query?: ToolRegistryQuery): RegistryEntry[];
  get(id: string): RegistryEntry | undefined;
  getByName(name: string): RegistryEntry | undefined;
  update(id: string, updater: (current: RegistryEntry) => RegistryEntry): RegistryEntry | undefined;
  retire(id: string, reason?: string): RegistryEntry | undefined;
  loadAll(): RegistryEntry[];
}

export class JsonlToolRegistry implements ToolRegistry {
  private readonly filePath: string;

  constructor(dir?: string) {
    const root = dir ?? path.join(homedir(), '.pyrfor');
    mkdirSync(root, { recursive: true });
    this.filePath = path.join(root, 'tool-registry.jsonl');
  }

  register(input: RegisterToolInput): RegistryEntry {
    return this.registerWithDisposition(input).entry;
  }

  registerWithDisposition(input: RegisterToolInput): { entry: RegistryEntry; created: boolean } {
    const all = this.readAll();
    const existing = all.find((entry) => entry.contentHash === input.contentHash);
    if (existing) return { entry: existing, created: false };

    const now = new Date().toISOString();
    const version = nextVersion(input.name, all);
    const status = input.status ?? 'pending_validation';
    const entry: RegistryEntry = {
      ...input,
      id: makeId(),
      status,
      version,
      trustHistory: input.trustHistory ?? [],
      failureScore: clampFailureScore(input.failureScore ?? 0),
      createdAt: now,
      updatedAt: now,
      tags: [...input.tags],
    };
    this.writeAll([...all, entry]);
    return { entry, created: true };
  }

  find(query: ToolRegistryQuery = {}): RegistryEntry[] {
    const needle = query.q?.trim().toLowerCase();
    return this.readAll()
      .filter((entry) => query.kind === undefined || entry.kind === query.kind)
      .filter((entry) => {
        if (query.status === undefined) return true;
        if (query.status === 'active') return entry.status !== 'retired';
        return entry.status === query.status;
      })
      .filter((entry) => query.tags === undefined || query.tags.every((tag) => entry.tags.includes(tag)))
      .filter((entry) => {
        if (!needle) return true;
        const haystack = [
          entry.name,
          entry.capability.description,
          ...entry.capability.triggers,
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, query.limit ?? Number.POSITIVE_INFINITY);
  }

  get(id: string): RegistryEntry | undefined {
    return this.readAll().find((entry) => entry.id === id);
  }

  getByName(name: string): RegistryEntry | undefined {
    return this.readAll()
      .filter((entry) => entry.name === name)
      .sort((a, b) => b.version - a.version)[0];
  }

  update(id: string, updater: (current: RegistryEntry) => RegistryEntry): RegistryEntry | undefined {
    const all = this.readAll();
    const index = all.findIndex((entry) => entry.id === id);
    if (index < 0) return undefined;
    const current = all[index]!;
    const candidate = updater(current);
    const now = new Date().toISOString();
    const updated: RegistryEntry = {
      ...candidate,
      id: current.id,
      createdAt: current.createdAt,
      version: current.version,
      failureScore: clampFailureScore(candidate.failureScore),
      updatedAt: now,
      tags: [...candidate.tags],
      trustHistory: [...candidate.trustHistory],
    };
    all[index] = updated;
    this.writeAll(all);
    return updated;
  }

  retire(id: string, reason = 'retired'): RegistryEntry | undefined {
    const all = this.readAll();
    const index = all.findIndex((entry) => entry.id === id);
    if (index < 0) return undefined;
    const current = all[index]!;
    if (current.status === 'retired') return current;
    const now = new Date().toISOString();
    const updated: RegistryEntry = {
      ...current,
      status: 'retired',
      updatedAt: now,
      retiredAt: now,
      trustHistory: [
        ...current.trustHistory,
        { at: now, from: current.status, to: 'retired', reason },
      ],
    };
    all[index] = updated;
    this.writeAll(all);
    return updated;
  }

  loadAll(): RegistryEntry[] {
    return this.readAll();
  }

  private readAll(): RegistryEntry[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RegistryEntry);
  }

  private writeAll(entries: RegistryEntry[]): void {
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
    writeFileSync(tmpPath, content ? `${content}\n` : '', 'utf8');
    renameSync(tmpPath, this.filePath);
  }
}

export function createToolRegistry(dir?: string): ToolRegistry {
  return new JsonlToolRegistry(dir);
}

function nextVersion(name: string, entries: RegistryEntry[]): number {
  const versions = entries.filter((entry) => entry.name === name).map((entry) => entry.version);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

function clampFailureScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function makeId(): string {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = Date.now();
  const ts = new Array<string>(10);
  for (let i = 9; i >= 0; i -= 1) {
    ts[i] = chars[time & 31]!;
    time = Math.floor(time / 32);
  }
  const rand = new Array<string>(16);
  for (let i = 0; i < 16; i += 1) rand[i] = chars[Math.floor(Math.random() * 32)]!;
  return `${ts.join('')}${rand.join('')}`;
}
