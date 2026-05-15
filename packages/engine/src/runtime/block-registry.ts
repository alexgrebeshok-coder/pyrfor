import type { ArtifactRef } from './artifact-model';
import type { BlockManifest } from './block-manifest';

export type BlockStatus = 'loading' | 'active' | 'inactive' | 'error' | 'revoked';

export interface BlockRegistryEntry {
  blockId: string;
  manifest: BlockManifest;
  status: BlockStatus;
  registeredAt: string;
  version?: string;
  rootDir?: string;
  manifestPath?: string;
  dataDir?: string;
  manifestRef?: ArtifactRef;
  error?: string;
}

export class BlockRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockRegistryError';
  }
}

export class BlockRegistry {
  private readonly entries = new Map<string, BlockRegistryEntry>();

  register(entry: BlockRegistryEntry): void {
    if (this.entries.has(entry.blockId)) {
      throw new BlockRegistryError(`BlockRegistry: duplicate block id "${entry.blockId}"`);
    }
    this.entries.set(entry.blockId, normalizeEntry(entry));
  }

  get(blockId: string): BlockRegistryEntry | undefined {
    const entry = this.entries.get(blockId);
    return entry ? normalizeEntry(entry) : undefined;
  }

  list(options: { status?: BlockStatus } = {}): BlockRegistryEntry[] {
    return [...this.entries.values()]
      .filter((entry) => options.status === undefined || entry.status === options.status)
      .map((entry) => normalizeEntry(entry));
  }

  updateStatus(blockId: string, status: BlockStatus, error?: string): void {
    const entry = this.entries.get(blockId);
    if (!entry) throw new BlockRegistryError(`BlockRegistry: unknown block id "${blockId}"`);
    this.entries.set(blockId, normalizeEntry({
      ...entry,
      status,
      ...(error !== undefined ? { error } : {}),
    }));
  }

  unregister(blockId: string): boolean {
    return this.entries.delete(blockId);
  }

  size(): number {
    return this.entries.size;
  }
}

function normalizeEntry(entry: BlockRegistryEntry): BlockRegistryEntry {
  return {
    ...entry,
    blockId: entry.blockId || entry.manifest.id,
    version: entry.version ?? entry.manifest.version,
  };
}
