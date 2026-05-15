/**
 * Durable persistence for the block catalog (registry entries + manifests).
 *
 * Design:
 * - One small JSON file: `<orchestrationDir>/block-catalog.json`
 * - Serializes every BlockRegistryEntry verbatim (manifest included) so
 *   hydration never needs to touch the filesystem or run any lifecycle code.
 * - memoryScopeMap is persisted as an array of [key, value] pairs so it
 *   round-trips through JSON without loss.
 * - On hydration, entries are injected directly into the BlockRegistry.
 *   Capability tools and contracts are rebuilt from the stored manifests.
 * - Safety invariants preserved:
 *   - no lifecycle/entrypoint execution
 *   - revoked stays revoked
 *   - no signing verification
 *   - no cloud behaviour
 */

import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ArtifactRef } from './artifact-model';
import type { BlockManifest } from './block-manifest';
import type { BlockMemoryNamespace, BlockMemoryScopeMap, MemoryNamespaceTier } from './block-memory-namespace';
import {
  BlockRegistry,
  BlockRegistryError,
  type BlockRegistryEntry,
  type BlockStatus,
} from './block-registry';
import { ContractRegistry, ContractRegistryError } from './contract-registry';
import type { ToolRegistry as CapabilityToolRegistry, ToolSpec } from './permission-engine';
import { deriveSideEffect } from './block-loader';

// ── Serialised shape ──────────────────────────────────────────────────────────

export interface PersistedMemoryScopeEntry {
  tier: string;
  tableName: string;
  scope: string;
}

export interface PersistedBlockEntry {
  blockId: string;
  projectId?: string;
  version?: string;
  status: BlockStatus;
  registeredAt: string;
  rootDir?: string;
  manifestPath?: string;
  dataDir?: string;
  manifest: BlockManifest;
  manifestRef?: ArtifactRef;
  /** Serialised Map<string, PersistedMemoryScopeEntry> */
  memoryScopeMap?: Array<[string, PersistedMemoryScopeEntry]>;
  error?: string;
}

export interface BlockCatalogSnapshot {
  version: 1;
  savedAt: string;
  blocks: PersistedBlockEntry[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class BlockCatalogStore {
  constructor(private readonly filePath: string) {}

  /**
   * Write the current block registry state to disk atomically.
   */
  flush(registry: BlockRegistry): void {
    const blocks: PersistedBlockEntry[] = registry.list().map(serializeEntry);
    const snapshot: BlockCatalogSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      blocks,
    };
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  /**
   * Hydrate a BlockRegistry (and optionally capability-tool / contract
   * registries) from the persisted catalog.
   *
   * Safe: does not execute lifecycle hooks, entrypoints, or perform signing
   * verification.  Revoked blocks are restored with status `revoked`.
   * Capability tools and contracts are rebuilt from stored manifest data.
   */
  hydrate(
    registry: BlockRegistry,
    options: {
      capabilityToolRegistry?: CapabilityToolRegistry;
      contractRegistry?: ContractRegistry;
    } = {},
  ): { restored: number; skipped: number; warnings: string[] } {
    if (!existsSync(this.filePath)) {
      return { restored: 0, skipped: 0, warnings: [] };
    }

    let snapshot: BlockCatalogSnapshot;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      snapshot = JSON.parse(raw) as BlockCatalogSnapshot;
    } catch {
      return { restored: 0, skipped: 0, warnings: [`block-catalog: failed to read ${this.filePath}`] };
    }

    if (!isValidSnapshot(snapshot)) {
      return { restored: 0, skipped: 0, warnings: [`block-catalog: unrecognised snapshot format in ${this.filePath}`] };
    }

    let restored = 0;
    let skipped = 0;
    const warnings: string[] = [];

    for (const persisted of snapshot.blocks) {
      try {
        const entry = deserializeEntry(persisted);
        registry.register(entry);

        if (entry.status !== 'revoked') {
          rebuildCapabilityTools(options.capabilityToolRegistry, entry.manifest);
          rebuildContracts(options.contractRegistry, entry.manifest, entry.manifestPath ?? '', warnings, entry.manifestRef);
        }

        restored++;
      } catch (err) {
        if (err instanceof BlockRegistryError) {
          // Duplicate – already registered (e.g. loaded programmatically before hydration)
          skipped++;
          continue;
        }
        warnings.push(
          `block-catalog: failed to restore ${persisted.blockId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped++;
      }
    }

    return { restored, skipped, warnings };
  }

  /** Path to the catalog file (useful for logging). */
  get path(): string {
    return this.filePath;
  }
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

function serializeEntry(entry: BlockRegistryEntry): PersistedBlockEntry {
  const out: PersistedBlockEntry = {
    blockId: entry.blockId,
    status: entry.status,
    registeredAt: entry.registeredAt,
    manifest: entry.manifest,
  };
  if (entry.projectId !== undefined) out.projectId = entry.projectId;
  if (entry.version !== undefined) out.version = entry.version;
  if (entry.rootDir !== undefined) out.rootDir = entry.rootDir;
  if (entry.manifestPath !== undefined) out.manifestPath = entry.manifestPath;
  if (entry.dataDir !== undefined) out.dataDir = entry.dataDir;
  if (entry.manifestRef !== undefined) out.manifestRef = entry.manifestRef;
  if (entry.error !== undefined) out.error = entry.error;
  if (entry.memoryScopeMap && entry.memoryScopeMap.size > 0) {
    out.memoryScopeMap = [...entry.memoryScopeMap.entries()].map(
      ([k, v]) => [k, { tier: v.tier, tableName: v.tableName, scope: v.scope }],
    );
  }
  return out;
}

function deserializeEntry(p: PersistedBlockEntry): BlockRegistryEntry {
  let memoryScopeMap: BlockMemoryScopeMap | undefined;
  if (p.memoryScopeMap && p.memoryScopeMap.length > 0) {
    memoryScopeMap = new Map<string, BlockMemoryNamespace>(
      p.memoryScopeMap.map(([k, v]) => [
        k,
        { tier: v.tier as MemoryNamespaceTier, tableName: v.tableName, scope: v.scope },
      ]),
    );
  }
  const entry: BlockRegistryEntry = {
    blockId: p.blockId,
    manifest: p.manifest,
    status: p.status,
    registeredAt: p.registeredAt,
  };
  if (p.projectId !== undefined) entry.projectId = p.projectId;
  if (p.version !== undefined) entry.version = p.version;
  if (p.rootDir !== undefined) entry.rootDir = p.rootDir;
  if (p.manifestPath !== undefined) entry.manifestPath = p.manifestPath;
  if (p.dataDir !== undefined) entry.dataDir = p.dataDir;
  if (p.manifestRef !== undefined) entry.manifestRef = p.manifestRef;
  if (p.error !== undefined) entry.error = p.error;
  if (memoryScopeMap !== undefined) entry.memoryScopeMap = memoryScopeMap;
  return entry;
}

function isValidSnapshot(value: unknown): value is BlockCatalogSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['version'] === 1 &&
    Array.isArray((value as Record<string, unknown>)['blocks'])
  );
}

// ── Registry rebuilders (no execution, no validation) ─────────────────────────

function rebuildCapabilityTools(
  toolRegistry: CapabilityToolRegistry | undefined,
  manifest: BlockManifest,
): void {
  if (!toolRegistry) return;
  for (const capability of manifest.capabilities) {
    const name = `block:${manifest.id}:${capability.token}`;
    if (toolRegistry.get(name)) continue;
    toolRegistry.register(toToolSpec(name, capability.token, capability.reason, manifest.security.sandbox));
  }
}

function rebuildContracts(
  contractRegistry: ContractRegistry | undefined,
  manifest: BlockManifest,
  manifestPath: string,
  warnings: string[],
  manifestRef?: ArtifactRef,
): void {
  if (!contractRegistry) return;
  for (const direction of ['consumes', 'produces'] as const) {
    for (const contract of manifest.contracts[direction]) {
      if (contractRegistry.get(contract.ref, { blockId: manifest.id, direction })) continue;
      try {
        const entryInput: Parameters<ContractRegistry['register']>[0] = {
          ref: contract.ref,
          blockId: manifest.id,
          direction,
          registeredAt: new Date().toISOString(),
          ...(contract.from ? { from: contract.from } : {}),
          ...(contract.optional !== undefined ? { optional: contract.optional } : {}),
        };
        if (direction === 'produces') {
          const producedContract = contract as BlockManifest['contracts']['produces'][number];
          if (producedContract.schema) entryInput.schema = { ...producedContract.schema };
          entryInput.provenance = {
            source: 'block-manifest',
            manifestPath,
            blockVersion: manifest.version,
            ...(manifestRef ? { manifestRef } : {}),
          };
        }
        contractRegistry.register(entryInput);
      } catch (err) {
        if (err instanceof ContractRegistryError) {
          warnings.push(`contracts.${direction}.${contract.ref}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }
}

function toToolSpec(
  name: string,
  token: string,
  reason: string,
  sandbox: string,
): ToolSpec {
  const sideEffect = deriveSideEffect(token);
  return {
    name,
    description: reason,
    inputSchema: {},
    outputSchema: {},
    sideEffect,
    defaultPermission: 'ask_once',
    timeoutMs: 30_000,
    sandbox,
    idempotent: sideEffect === 'read',
    requiresApproval: sideEffect !== 'read',
  };
}
