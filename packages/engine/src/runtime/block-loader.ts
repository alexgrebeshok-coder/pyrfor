import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger } from './event-ledger';
import type { SideEffectClass, ToolRegistry, ToolSpec } from './permission-engine';
import { loadBlockManifest, validateBlockPackage, type BlockManifest, type BlockPackageValidationReport } from './block-manifest';
import {
  BlockMemoryNamespaceError,
  scopeStringFor,
  type BlockMemoryScopeMap,
} from './block-memory-namespace';
import { BlockRegistry, BlockRegistryError, type BlockRegistryEntry, type BlockStatus } from './block-registry';
import { ContractRegistry, ContractRegistryError } from './contract-registry';

export interface BlockLoaderOptions {
  registry?: BlockRegistry;
  toolRegistry?: ToolRegistry;
  contractRegistry?: ContractRegistry;
  ledger?: EventLedger;
  artifactStore?: ArtifactStore;
  dataRootDir?: string;
  projectId?: string;
  runId?: string;
}

export interface BlockLoadResult {
  ok: boolean;
  blockId: string;
  status?: BlockStatus;
  manifest?: BlockManifest;
  entry?: BlockRegistryEntry;
  report?: BlockPackageValidationReport;
  manifestRef?: ArtifactRef;
  resultRef?: ArtifactRef;
  error?: string;
  warnings: string[];
  registeredCapabilityTools: string[];
  registeredContractRefs: string[];
}

export async function loadBlock(blockPath: string, options: BlockLoaderOptions = {}): Promise<BlockLoadResult> {
  const report = await validateBlockPackage(blockPath);
  const warnings = report.warnings.map((warning) => `${warning.path}: ${warning.message}`);
  const blockId = report.summary.id ?? 'unknown';
  if (report.status !== 'valid' || !report.manifest) {
    const error = report.errors[0] ? `${report.errors[0].path}: ${report.errors[0].message}` : 'block manifest validation failed';
    const resultRef = await writeLoadResultArtifact(options, { ok: false, blockId, status: 'error', error, warnings, report });
    await appendBlockEvent(options, 'block.error', blockId, { status: 'error', error, warnings, resultRef });
    return { ok: false, blockId, status: 'error', report, resultRef, error, warnings, registeredCapabilityTools: [], registeredContractRefs: [] };
  }

  const registry = options.registry ?? new BlockRegistry();
  const loaded = await loadBlockManifest(blockPath);
  const manifestRef = await writeManifestArtifact(options, loaded.manifest);
  const dataDir = path.join(options.dataRootDir ?? path.join(tmpdir(), 'pyrfor-blocks'), sanitizeBlockId(loaded.manifest.id));
  await mkdir(dataDir, { recursive: true });
  const memoryScopeMap = resolveOptionalMemoryScopes(loaded.manifest, options.projectId, warnings);

  const entry: BlockRegistryEntry = {
    blockId: loaded.manifest.id,
    version: loaded.manifest.version,
    manifest: loaded.manifest,
    status: 'inactive',
    registeredAt: new Date().toISOString(),
    rootDir: loaded.rootDir,
    manifestPath: loaded.manifestPath,
    dataDir,
    ...(manifestRef ? { manifestRef } : {}),
    ...(memoryScopeMap && memoryScopeMap.size > 0 ? { memoryScopeMap } : {}),
  };

  try {
    registry.register(entry);
  } catch (err) {
    const error = err instanceof BlockRegistryError ? err.message : formatError(err);
    const resultRef = await writeLoadResultArtifact(options, {
      ok: false,
      blockId: loaded.manifest.id,
      status: 'error',
      version: loaded.manifest.version,
      error,
      warnings,
      manifestRef,
      report,
    });
    await appendBlockEvent(options, 'block.error', loaded.manifest.id, {
      status: 'error',
      version: loaded.manifest.version,
      error,
      warnings,
      manifestRef,
      resultRef,
    });
    return {
      ok: false,
      blockId: loaded.manifest.id,
      status: 'error',
      manifest: loaded.manifest,
      report,
      manifestRef,
      resultRef,
      error,
      warnings,
      registeredCapabilityTools: [],
      registeredContractRefs: [],
    };
  }

  const registeredCapabilityTools = registerCapabilityTools(options.toolRegistry, loaded.manifest);
  const registeredContractRefs = registerContracts(options.contractRegistry, loaded.manifest, loaded.manifestPath, warnings, manifestRef);
  const resultRef = await writeLoadResultArtifact(options, {
    ok: true,
    blockId: loaded.manifest.id,
    status: 'inactive',
    version: loaded.manifest.version,
    warnings,
    manifestRef,
    registeredCapabilityTools,
    registeredContractRefs,
    report,
  });
  await appendBlockEvent(options, 'block.loaded', loaded.manifest.id, {
    status: 'inactive',
    version: loaded.manifest.version,
    manifestRef,
    resultRef,
    warnings,
    registeredCapabilityTools,
    registeredContractRefs,
  });

  return {
    ok: true,
    blockId: loaded.manifest.id,
    status: 'inactive',
    manifest: loaded.manifest,
    entry: registry.get(loaded.manifest.id) ?? entry,
    report,
    manifestRef,
    resultRef,
    warnings,
    registeredCapabilityTools,
    registeredContractRefs,
  };
}

export async function activateBlock(
  blockId: string,
  registry: BlockRegistry,
  options: Pick<BlockLoaderOptions, 'ledger' | 'runId'> = {},
): Promise<BlockLoadResult> {
  const entry = registry.get(blockId);
  if (!entry) return blockStatusFailure(blockId, 'unknown block id');
  registry.updateStatus(blockId, 'active');
  const updated = registry.get(blockId);
  await appendBlockEvent(options, 'block.activated', blockId, {
    status: 'active',
    version: entry.version,
    manifestRef: entry.manifestRef,
  });
  return {
    ok: true,
    blockId,
    status: 'active',
    manifest: updated?.manifest ?? entry.manifest,
    entry: updated,
    warnings: [],
    registeredCapabilityTools: [],
    registeredContractRefs: [],
  };
}

export async function deactivateBlock(
  blockId: string,
  registry: BlockRegistry,
  options: Pick<BlockLoaderOptions, 'ledger' | 'runId'> = {},
): Promise<BlockLoadResult> {
  const entry = registry.get(blockId);
  if (!entry) return blockStatusFailure(blockId, 'unknown block id');
  registry.updateStatus(blockId, 'inactive');
  const updated = registry.get(blockId);
  await appendBlockEvent(options, 'block.deactivated', blockId, {
    status: 'inactive',
    version: entry.version,
    manifestRef: entry.manifestRef,
  });
  return {
    ok: true,
    blockId,
    status: 'inactive',
    manifest: updated?.manifest ?? entry.manifest,
    entry: updated,
    warnings: [],
    registeredCapabilityTools: [],
    registeredContractRefs: [],
  };
}

async function writeManifestArtifact(options: BlockLoaderOptions, manifest: BlockManifest): Promise<ArtifactRef | undefined> {
  if (!options.artifactStore) return undefined;
  return options.artifactStore.writeJSON('block_manifest', manifest, {
    runId: options.runId,
    meta: { blockId: manifest.id, version: manifest.version },
  });
}

async function writeLoadResultArtifact(options: BlockLoaderOptions, value: Record<string, unknown>): Promise<ArtifactRef | undefined> {
  if (!options.artifactStore) return undefined;
  return options.artifactStore.writeJSON('block_load_result', value, {
    runId: options.runId,
    meta: { blockId: String(value.blockId ?? 'unknown'), status: String(value.status ?? 'unknown') },
  });
}

function registerCapabilityTools(toolRegistry: ToolRegistry | undefined, manifest: BlockManifest): string[] {
  if (!toolRegistry) return [];
  const registered: string[] = [];
  for (const capability of manifest.capabilities) {
    const name = `block:${manifest.id}:${capability.token}`;
    if (toolRegistry.get(name)) continue;
    toolRegistry.register(toToolSpec(name, capability.token, capability.reason, manifest.security.sandbox));
    registered.push(name);
  }
  return registered;
}

function registerContracts(
  contractRegistry: ContractRegistry | undefined,
  manifest: BlockManifest,
  manifestPath: string,
  warnings: string[],
  manifestRef?: ArtifactRef,
): string[] {
  if (!contractRegistry) return [];
  const registered: string[] = [];
  for (const direction of ['consumes', 'produces'] as const) {
    const refs = manifest.contracts[direction];
    for (const contract of refs) {
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
        const entry = contractRegistry.register(entryInput);
        registered.push(entry.ref);
      } catch (err) {
        if (err instanceof ContractRegistryError) {
          warnings.push(`contracts.${direction}.${contract.ref}: ${err.message}`);
          continue;
        }
        throw err;
      }
    }
  }
  return registered;
}

function resolveOptionalMemoryScopes(manifest: BlockManifest, projectId: string | undefined, warnings: string[]): BlockMemoryScopeMap | undefined {
  if (!manifest.memory_scope) return undefined;
  const result: BlockMemoryScopeMap = new Map();
  for (const tier of ['project_shared', 'block_private', 'global_shared'] as const) {
    for (const tableName of manifest.memory_scope[tier] ?? []) {
      try {
        result.set(`${tier}:${tableName}`, {
          tier,
          tableName,
          scope: scopeStringFor(tier, tableName, manifest.id, projectId, manifest.runtime.mode),
        });
      } catch (err) {
        if (err instanceof BlockMemoryNamespaceError) {
          warnings.push(`memory_scope.${tier}.${tableName}: ${err.message}`);
          continue;
        }
        throw err;
      }
    }
  }
  return result;
}

function toToolSpec(name: string, token: string, reason: string, sandbox: string): ToolSpec {
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

export function deriveSideEffect(token: string): SideEffectClass {
  if (/\b(delete|destroy|remove|rollback|uninstall)\b/.test(token)) return 'destructive';
  if (/\b(exec|execute|spawn|process|run|install|activate|deactivate|upgrade)\b/.test(token)) return 'execute';
  if (/\b(net|network|http|fetch|remote|mcp|a2a|cloud)\b/.test(token)) return 'network';
  if (/\b(invoke|call)\b/.test(token)) return 'execute';
  if (/\b(write|create|update|mutate|publish|propose|notify)\b/.test(token)) return 'write';
  return 'read';
}

async function appendBlockEvent(
  options: Pick<BlockLoaderOptions, 'ledger' | 'runId'>,
  type: 'block.loaded' | 'block.activated' | 'block.deactivated' | 'block.error',
  blockId: string,
  payload: {
    status: BlockStatus;
    version?: string;
    error?: string;
    warnings?: string[];
    manifestRef?: ArtifactRef;
    resultRef?: ArtifactRef;
    registeredCapabilityTools?: string[];
    registeredContractRefs?: string[];
  },
): Promise<void> {
  if (!options.ledger) return;
  await options.ledger.append({
    type,
    run_id: options.runId ?? `block:${blockId}`,
    block_id: blockId,
    status: payload.status,
    ...(payload.version ? { version: payload.version } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    ...(payload.warnings ? { warnings: payload.warnings } : {}),
    ...(payload.manifestRef ? { manifest_ref: payload.manifestRef } : {}),
    ...(payload.resultRef ? { result_ref: payload.resultRef } : {}),
    ...(payload.registeredCapabilityTools ? { registered_capability_tools: payload.registeredCapabilityTools } : {}),
    ...(payload.registeredContractRefs ? { registered_contract_refs: payload.registeredContractRefs } : {}),
  });
}

function blockStatusFailure(blockId: string, error: string): BlockLoadResult {
  return { ok: false, blockId, status: 'error', error, warnings: [], registeredCapabilityTools: [], registeredContractRefs: [] };
}

function sanitizeBlockId(blockId: string): string {
  return blockId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
