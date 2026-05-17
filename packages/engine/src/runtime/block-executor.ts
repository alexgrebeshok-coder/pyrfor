import { access } from 'node:fs/promises';
import path from 'node:path';
import { execCommand, type ToolContext, type ToolResult } from './tools';
import type { BlockRegistryEntry } from './block-registry';
import type { EventLedger } from './event-ledger';
import type { ArtifactStore, ArtifactRef } from './artifact-model';

export interface BlockExecuteOptions {
  ledger?: EventLedger;
  artifactStore?: ArtifactStore;
  runId?: string;
  projectId?: string;
  input?: Record<string, unknown>;
  toolContext?: ToolContext;
  timeoutMs?: number;
}

export interface BlockExecuteResult {
  ok: boolean;
  blockId: string;
  status: 'completed' | 'error';
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  resultRef?: ArtifactRef;
  error?: string;
}

export async function executeBlockMain(
  entry: BlockRegistryEntry,
  options: BlockExecuteOptions = {},
): Promise<BlockExecuteResult> {
  const blockId = entry.blockId;
  const rootDir = entry.rootDir;
  if (!rootDir) {
    return { ok: false, blockId, status: 'error', error: 'block registry entry missing rootDir' };
  }
  const mainRel = entry.manifest.entrypoints.main?.trim();
  if (!mainRel) {
    return { ok: false, blockId, status: 'error', error: 'block manifest missing entrypoints.main' };
  }

  const mainPath = path.join(rootDir, mainRel);
  try {
    await access(mainPath);
  } catch {
    return { ok: false, blockId, status: 'error', error: `entrypoint not found: ${mainRel}` };
  }

  const envPrefix = options.input
    ? `PYRFOR_BLOCK_INPUT=${JSON.stringify(JSON.stringify(options.input))} `
    : '';
  const command = `${envPrefix}node ${JSON.stringify(mainPath)}`;
  const execResult = await execCommand(command, {
    timeout: options.timeoutMs ?? 60_000,
  }, {
    ...options.toolContext,
    execRoot: rootDir,
    runId: options.runId,
  });

  const payload: BlockExecuteResult = {
    ok: execResult.success,
    blockId,
    status: execResult.success ? 'completed' : 'error',
    exitCode: (execResult.data as { exitCode?: number }).exitCode,
    stdout: (execResult.data as { stdout?: string }).stdout,
    stderr: (execResult.data as { stderr?: string }).stderr,
    error: execResult.error,
  };

  if (options.artifactStore) {
    payload.resultRef = await options.artifactStore.writeJSON('block_load_result', payload, {
      runId: options.runId,
      meta: { blockId, projectId: options.projectId, status: payload.status },
    });
  }

  if (!payload.ok && options.ledger && options.runId) {
    await options.ledger.append({
      type: 'block.error',
      run_id: options.runId,
      block_id: blockId,
      project_id: options.projectId,
      status: 'error',
      error: payload.error,
    });
  }

  return payload;
}

export function blockExecuteToToolResult(result: BlockExecuteResult): ToolResult<BlockExecuteResult> {
  return {
    success: result.ok,
    data: result,
    error: result.error,
  };
}
