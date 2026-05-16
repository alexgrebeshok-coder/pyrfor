import type { ArtifactRef } from './artifact-model';
import type { BlockManifest } from './block-manifest';
import type { BlockMemoryScopeMap } from './block-memory-namespace';

export type BlockStatus = 'loading' | 'active' | 'inactive' | 'error' | 'revoked';

export interface BlockRegistryEntry {
  blockId: string;
  projectId?: string;
  manifest: BlockManifest;
  status: BlockStatus;
  registeredAt: string;
  version?: string;
  rootDir?: string;
  manifestPath?: string;
  dataDir?: string;
  manifestRef?: ArtifactRef;
  memoryScopeMap?: BlockMemoryScopeMap;
  error?: string;
}

export class BlockRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockRegistryError';
  }
}

const LOCAL_BLOCK_SCOPE_KEY = '\u0000local';

export class BlockRegistry {
  private readonly entries = new Map<string, BlockRegistryEntry>();

  register(entry: BlockRegistryEntry): void {
    const normalized = normalizeEntry(entry);
    const registryKey = toRegistryKey(normalized.blockId, normalized.projectId);
    if (this.entries.has(registryKey)) {
      throw new BlockRegistryError(
        `BlockRegistry: duplicate block id "${normalized.blockId}"${normalized.projectId ? ` for project "${normalized.projectId}"` : ''}`,
      );
    }
    this.entries.set(registryKey, normalized);
  }

  get(blockId: string, projectId?: string): BlockRegistryEntry | undefined {
    const entry = this.entries.get(toRegistryKey(blockId, projectId));
    return entry ? normalizeEntry(entry) : undefined;
  }

  list(options: { status?: BlockStatus; projectId?: string } = {}): BlockRegistryEntry[] {
    return [...this.entries.values()]
      .filter((entry) =>
        (options.status === undefined || entry.status === options.status) &&
        (options.projectId === undefined || entry.projectId === options.projectId)
      )
      .map((entry) => normalizeEntry(entry));
  }

  updateStatus(blockId: string, status: BlockStatus, error?: string, projectId?: string): void {
    const registryKey = toRegistryKey(blockId, projectId);
    const entry = this.entries.get(registryKey);
    if (!entry) {
      throw new BlockRegistryError(
        `BlockRegistry: unknown block id "${blockId}"${projectId ? ` for project "${projectId}"` : ''}`,
      );
    }
    this.entries.set(registryKey, normalizeEntry({
      ...entry,
      status,
      ...(error !== undefined ? { error } : {}),
    }));
  }

  unregister(blockId: string, projectId?: string): boolean {
    return this.entries.delete(toRegistryKey(blockId, projectId));
  }

  size(): number {
    return this.entries.size;
  }
}

function normalizeEntry(entry: BlockRegistryEntry): BlockRegistryEntry {
  return {
    ...entry,
    blockId: entry.blockId || entry.manifest.id,
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    version: entry.version ?? entry.manifest.version,
  };
}

function toRegistryKey(blockId: string, projectId?: string): string {
  return `${projectId ?? LOCAL_BLOCK_SCOPE_KEY}::${blockId}`;
}
