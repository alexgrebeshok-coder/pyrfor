import type { ArtifactRef } from './artifact-model';
import type { BlockContractSchemaMetadata } from './block-manifest';

export interface ContractRef {
  ref: string;
  name: string;
  major: number;
}

export type ContractDirection = 'consumes' | 'produces';

export interface ContractRegistryEntry extends ContractRef {
  blockId: string;
  direction: ContractDirection;
  registeredAt: string;
  from?: string;
  optional?: boolean;
  schema?: BlockContractSchemaMetadata;
  provenance?: ContractRegistryProvenance;
}

export interface ContractRegistryProvenance {
  source: 'block-manifest';
  manifestPath: string;
  blockVersion: string;
  manifestRef?: ArtifactRef;
}

export interface ContractRegistryQuery {
  ref?: string;
  blockId?: string;
  direction?: ContractDirection;
}

export class ContractRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractRegistryError';
  }
}

const CONTRACT_REF_RE = /^([A-Z][A-Za-z0-9]*)@([1-9]\d*)$/;

export function parseContractRef(ref: string): ContractRef | null {
  const match = CONTRACT_REF_RE.exec(ref);
  if (!match) return null;
  const major = Number(match[2]);
  if (!Number.isSafeInteger(major) || major < 1) return null;
  return { ref, name: match[1]!, major };
}

export class ContractRegistry {
  private readonly entries = new Map<string, Map<string, ContractRegistryEntry>>();

  register(entry: Omit<ContractRegistryEntry, 'name' | 'major'> & Partial<Pick<ContractRegistryEntry, 'name' | 'major'>>): ContractRegistryEntry {
    const parsed = parseContractRef(entry.ref);
    if (!parsed) throw new ContractRegistryError(`ContractRegistry: invalid contract ref "${entry.ref}"`);
    const normalized: ContractRegistryEntry = {
      ...entry,
      ref: parsed.ref,
      name: parsed.name,
      major: parsed.major,
    };
    const entryKey = contractEntryKey(normalized);
    const bucket = this.entries.get(parsed.ref) ?? new Map<string, ContractRegistryEntry>();
    if (bucket.has(entryKey)) {
      throw new ContractRegistryError(
        `ContractRegistry: duplicate contract ref "${parsed.ref}" for block "${normalized.blockId}" (${normalized.direction})`,
      );
    }
    const stored = cloneContractRegistryEntry(normalized);
    bucket.set(entryKey, stored);
    this.entries.set(parsed.ref, bucket);
    return cloneContractRegistryEntry(stored);
  }

  get(ref: string, options: Omit<ContractRegistryQuery, 'ref'> = {}): ContractRegistryEntry | undefined {
    const parsed = parseContractRef(ref);
    if (!parsed) return undefined;
    const entry = this.findEntries({ ref: parsed.ref, ...options })[0];
    return entry ? cloneContractRegistryEntry(entry) : undefined;
  }

  has(ref: string, options: Omit<ContractRegistryQuery, 'ref'> = {}): boolean {
    return this.get(ref, options) !== undefined;
  }

  list(options: ContractRegistryQuery = {}): ContractRegistryEntry[] {
    return this.findEntries(options)
      .map((entry) => cloneContractRegistryEntry(entry));
  }

  size(): number {
    return [...this.entries.values()].reduce((count, bucket) => count + bucket.size, 0);
  }

  private findEntries(options: ContractRegistryQuery): ContractRegistryEntry[] {
    const refs = options.ref ? [options.ref] : [...this.entries.keys()];
    const entries: ContractRegistryEntry[] = [];
    for (const ref of refs) {
      const bucket = this.entries.get(ref);
      if (!bucket) continue;
      for (const entry of bucket.values()) {
        if (options.direction !== undefined && entry.direction !== options.direction) continue;
        if (options.blockId !== undefined && entry.blockId !== options.blockId) continue;
        entries.push(entry);
      }
    }
    return entries;
  }
}

function contractEntryKey(entry: Pick<ContractRegistryEntry, 'blockId' | 'direction'>): string {
  return `${entry.blockId}\u0000${entry.direction}`;
}

function cloneContractRegistryEntry(entry: ContractRegistryEntry): ContractRegistryEntry {
  return {
    ...entry,
    ...(entry.schema ? { schema: { ...entry.schema } } : {}),
    ...(entry.provenance
      ? {
          provenance: {
            ...entry.provenance,
            ...(entry.provenance.manifestRef ? { manifestRef: cloneArtifactRef(entry.provenance.manifestRef) } : {}),
          },
        }
      : {}),
  };
}

function cloneArtifactRef(ref: ArtifactRef): ArtifactRef {
  return {
    ...ref,
    ...(ref.meta ? { meta: cloneUnknown(ref.meta) as Record<string, unknown> } : {}),
  };
}

function cloneUnknown<T>(value: T): T {
  return structuredClone(value);
}
