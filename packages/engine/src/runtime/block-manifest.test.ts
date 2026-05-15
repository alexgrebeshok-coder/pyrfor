import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateBlockPackage, type BlockManifest } from './block-manifest';

describe('Block Manifest v1 validator', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-block-manifest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid dev block package', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('valid');
    expect(report.errors).toEqual([]);
    expect(report.summary).toMatchObject({
      id: 'com.example.translate-block',
      version: '0.1.0',
      capabilityCount: 2,
      consumedContractCount: 0,
      producedContractCount: 1,
      panelCount: 1,
      certificationState: 'dev',
    });
    expect(report.warnings.map((warning) => warning.code)).toContain('signing_missing');
  });

  it('rejects broad capabilities and missing optimizer guardrails', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [
        { token: 'fs:*', reason: 'too broad' },
      ],
      optimizer_policy: {
        editable: true,
        editable_fields: ['prompts'],
        never_editable: ['id'],
        requires_human_approval: ['runtime'],
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'capability_wildcard',
      'capability_token_invalid',
      'optimizer_never_editable_missing',
      'optimizer_human_approval_missing',
    ]));
  });

  it('requires namespaced capability tokens', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [
        { token: 'local-llm', reason: 'missing action segment' },
      ],
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'capabilities.0.token',
        code: 'capability_token_invalid',
      }),
    ]));
  });

  it('checks package lifecycle scripts referenced by block.json', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      scripts: {
        test: 'vitest run',
        activate: 'node scripts/on-activate.js',
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'package.json.scripts.activate',
        code: 'package_script_missing',
      }),
    ]));
  });

  it('requires sbom and signing metadata for pilot blocks', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      certification: {
        state: 'pilot',
        sbom: 'sbom.cdx.json',
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'signing_required',
      'sbom_missing',
    ]));
  });

  it('rejects malformed contract refs', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      contracts: {
        consumes: [],
        produces: [{ ref: 'ApprovalEvidence' }],
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'contracts.produces.0.ref',
        code: 'pattern_mismatch',
      }),
    ]));
  });

  it('warns when memory scopes lack matching memory capabilities', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      memory_scope: {
        project_shared: ['estimate_items'],
        block_private: ['calculation_cache'],
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('valid');
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'memory_scope.project_shared',
        code: 'memory_capability_missing',
      }),
      expect.objectContaining({
        path: 'memory_scope.block_private',
        code: 'memory_capability_missing',
      }),
    ]));
  });

  it('rejects unsafe memory scope names and global shared declarations', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      memory_scope: {
        project_shared: ['Estimate Items'],
        global_shared: ['regulatory_norms'],
      },
    }));

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'memory_scope.project_shared.0',
        code: 'memory_table_name_invalid',
      }),
      expect.objectContaining({
        path: 'memory_scope.global_shared',
        code: 'global_shared_requires_review',
      }),
    ]));
  });

  it('reports missing block.json as an invalid package', async () => {
    writePackage(dir, { test: 'vitest run' });

    const report = await validateBlockPackage(dir);

    expect(report.status).toBe('invalid');
    expect(report.errors).toEqual([
      expect.objectContaining({ code: 'manifest_unreadable' }),
    ]);
  });
});

function writePackage(root: string, scripts: Record<string, string>): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }, null, 2), 'utf8');
}

function writeManifest(root: string, body: BlockManifest): void {
  writeFileSync(path.join(root, 'block.json'), JSON.stringify(body, null, 2), 'utf8');
}

function manifest(overrides: Partial<BlockManifest> = {}): BlockManifest {
  return {
    pyrfor_manifest_version: '1',
    id: 'com.example.translate-block',
    name: 'Translate Block',
    version: '0.1.0',
    description: 'Local LLM translation demo.',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: {
      main: 'dist/index.js',
    },
    scripts: {
      test: 'vitest run',
    },
    capabilities: [
      { token: 'local-llm:invoke', reason: 'Translate text locally' },
      { token: 'trust-panel:notify', reason: 'Notify user when translation completes' },
    ],
    contracts: {
      consumes: [],
      produces: [{ ref: 'ApprovalEvidence@1' }],
    },
    events: {
      publishes: ['translation.completed'],
      subscribes: [],
    },
    panels: [{
      id: 'translate-main',
      slot: 'center',
      label: 'Translate',
      entry: 'ui/MainPanel.tsx',
    }],
    optimizer_policy: {
      editable: true,
      editable_fields: ['prompts'],
      never_editable: ['id', 'version', 'capabilities', 'security', 'signing'],
      requires_human_approval: ['runtime', 'entrypoints', 'scripts'],
    },
    security: {
      sandbox: 'process-isolated',
      allow_fs_read: [],
      allow_fs_write: [],
      allow_network: false,
      allow_child_process: false,
      secrets_access: [],
      max_memory_mb: 256,
      max_cpu_pct: 30,
    },
    certification: {
      state: 'dev',
    },
    ...overrides,
  };
}
