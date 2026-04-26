// @vitest-environment node
/**
 * Tests for packages/engine/src/subagents/repo-mapper.ts
 *
 * Creates a small synthetic repository in a temp directory, exercises the
 * RepoMapper class and all exported pure helpers.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  RepoMapper,
  detectLanguage,
  detectPackageManager,
  isDocumentationFile,
  isTestDir,
  isConfigFile,
  computeLanguagePercent,
  summarize,
  subagentSpec,
  type RepoMap,
} from './repo-mapper.js';

// ====== Fake-repo builder ======

/** Write a file, creating parent directories as needed. */
async function write(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, 'utf-8');
}

/**
 * Build the standard fake repository used by most tests:
 *
 *   <root>/
 *     ts-pkg/
 *       package.json            (npm package, main: ./src/index.js)
 *       tsconfig.json
 *       README.md
 *       src/index.ts
 *       __tests__/foo.test.ts
 *       node_modules/dep/index.js   ← must be ignored
 *     py-pkg/
 *       pyproject.toml          ([tool.poetry] name = "py-pkg")
 *       src/main.py
 *       tests/test_main.py
 *     rust-crate/
 *       Cargo.toml              ([package] name = "rust-crate")
 *       src/main.rs
 *     .secret                   ← hidden; ignored unless includeHidden=true
 */
async function buildFakeRepo(root: string): Promise<void> {
  // ts-pkg
  await write(
    path.join(root, 'ts-pkg', 'package.json'),
    JSON.stringify({ name: 'ts-pkg', version: '1.0.0', private: true, main: './src/index.js' }),
  );
  await write(path.join(root, 'ts-pkg', 'tsconfig.json'), '{"compilerOptions":{}}');
  await write(path.join(root, 'ts-pkg', 'README.md'), '# TS Package');
  await write(path.join(root, 'ts-pkg', 'src', 'index.ts'), 'export const x = 1;');
  await write(path.join(root, 'ts-pkg', '__tests__', 'foo.test.ts'), "it('x', () => {});");
  // node_modules — must be ignored
  await write(path.join(root, 'ts-pkg', 'node_modules', 'dep', 'index.js'), 'module.exports={}');

  // py-pkg
  await write(
    path.join(root, 'py-pkg', 'pyproject.toml'),
    '[tool.poetry]\nname = "py-pkg"\nversion = "0.2.0"\n',
  );
  await write(path.join(root, 'py-pkg', 'src', 'main.py'), 'def main(): pass');
  await write(path.join(root, 'py-pkg', 'tests', 'test_main.py'), 'import pytest');

  // rust-crate
  await write(
    path.join(root, 'rust-crate', 'Cargo.toml'),
    '[package]\nname = "rust-crate"\nversion = "0.1.0"\n',
  );
  await write(path.join(root, 'rust-crate', 'src', 'main.rs'), 'fn main() {}');

  // hidden file
  await write(path.join(root, '.secret'), 'top-secret');
}

// ====== Test lifecycle ======

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repo-mapper-'));
  await buildFakeRepo(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ====== Pure-helper unit tests ======

describe('detectLanguage', () => {
  it.each<[string, string | null]>([
    ['foo.ts',    'TypeScript'],
    ['foo.tsx',   'TypeScript'],
    ['foo.js',    'JavaScript'],
    ['foo.py',    'Python'],
    ['foo.rs',    'Rust'],
    ['foo.go',    'Go'],
    ['foo.java',  'Java'],
    ['foo.rb',    'Ruby'],
    ['foo.md',    'Markdown'],
    ['foo.json',  'JSON'],
    ['foo.yaml',  'YAML'],
    ['foo.html',  'HTML'],
    ['foo.css',   'CSS'],
    ['foo.scss',  'SCSS'],
    ['foo.sh',    'Shell'],
    ['foo.kt',    'Kotlin'],
    ['foo.swift', 'Swift'],
    ['foo.cpp',   'C++'],
    ['foo.c',     'C'],
    ['foo.h',     'C'],
    ['foo.xyz',   null],
    ['Makefile',  null],
  ])('detectLanguage(%s) → %s', (filename, expected) => {
    expect(detectLanguage(filename)).toBe(expected);
  });
});

describe('detectPackageManager', () => {
  it.each<[string[], ReturnType<typeof detectPackageManager>]>([
    [['package.json', 'pnpm-lock.yaml'],         'pnpm'],
    [['package.json', 'pnpm-workspace.yaml'],     'pnpm'],
    [['package.json', 'yarn.lock'],               'yarn'],
    [['package.json', 'package-lock.json'],       'npm'],
    [['package.json'],                            'npm'],
    [['Cargo.toml'],                              'cargo'],
    [['pyproject.toml'],                          'python'],
    [['requirements.txt'],                        'python'],
    [['go.mod'],                                  'go'],
    [['README.md'],                               'unknown'],
  ])('%j → %s', (filenames, expected) => {
    expect(detectPackageManager(filenames)).toBe(expected);
  });
});

describe('isDocumentationFile', () => {
  it.each<[string, boolean]>([
    ['README.md',        true],
    ['README',           true],
    ['readme.rst',       true],
    ['CHANGELOG.md',     true],
    ['CHANGELOG',        true],
    ['LICENSE',          true],
    ['LICENSE.txt',      true],
    ['CONTRIBUTING.md',  true],
    ['AUTHORS',          true],
    ['NOTICE.txt',       true],
    ['HISTORY.md',       true],
    ['SECURITY.md',      true],
    ['index.ts',         false],
    ['package.json',     false],
    ['src',              false],
  ])('isDocumentationFile(%s) → %s', (name, expected) => {
    expect(isDocumentationFile(name)).toBe(expected);
  });
});

describe('isTestDir', () => {
  it.each<[string, boolean]>([
    ['test',       true],
    ['tests',      true],
    ['__tests__',  true],
    ['spec',       true],
    ['specs',      true],
    ['test_utils', true],
    ['spec_helpers',true],
    ['src',        false],
    ['dist',       false],
    ['lib',        false],
    ['components', false],
  ])('isTestDir(%s) → %s', (name, expected) => {
    expect(isTestDir(name)).toBe(expected);
  });
});

describe('isConfigFile', () => {
  it.each<[string, boolean]>([
    ['tsconfig.json',         true],
    ['tsconfig.base.json',    true],
    ['tsconfig.build.json',   true],
    ['package.json',          true],
    ['pnpm-workspace.yaml',   true],
    ['Cargo.toml',            true],
    ['pyproject.toml',        true],
    ['go.mod',                true],
    ['Dockerfile',            true],
    ['vite.config.ts',        true],
    ['vite.config.mts',       true],
    ['vitest.config.ts',      true],
    ['jest.config.js',        true],
    ['.eslintrc.json',        true],
    ['README.md',             false],
    ['index.ts',              false],
    ['foo.config.ts',         false],
  ])('isConfigFile(%s) → %s', (name, expected) => {
    expect(isConfigFile(name)).toBe(expected);
  });
});

describe('computeLanguagePercent', () => {
  it('sums to 100 for two equal buckets', () => {
    const result = computeLanguagePercent({
      TypeScript: { bytes: 500 },
      Python:     { bytes: 500 },
    });
    expect(result.TypeScript).toBe(50);
    expect(result.Python).toBe(50);
    expect(result.TypeScript + result.Python).toBeCloseTo(100, 0);
  });

  it('returns 0 for empty stats', () => {
    const result = computeLanguagePercent({ Go: { bytes: 0 } });
    expect(result.Go).toBe(0);
  });

  it('rounds to two decimal places', () => {
    const result = computeLanguagePercent({
      A: { bytes: 1 },
      B: { bytes: 2 },
    });
    // 33.33 + 66.67 = 100.00
    expect(result.A + result.B).toBeCloseTo(100, 0);
  });
});

describe('summarize', () => {
  it('returns a deterministic non-empty string for the same map', () => {
    const map: RepoMap = {
      rootDir:            '/repo',
      scannedAt:          '2024-01-01T00:00:00.000Z',
      truncated:          false,
      fileCount:          5,
      dirCount:           2,
      totalBytes:         1000,
      languages:          { TypeScript: { files: 3, bytes: 900, percent: 90 }, JSON: { files: 2, bytes: 100, percent: 10 } },
      packages:           [{ relPath: '.', manager: 'npm', name: 'my-pkg', version: '1.0.0' }],
      entryPoints:        [{ relPath: 'src/index.ts', kind: 'main', source: 'heuristic' }],
      topLevel:           [{ name: 'src', type: 'dir' }],
      documentationFiles: ['README.md'],
      testDirs:           ['__tests__'],
      configFiles:        ['package.json', 'tsconfig.json'],
    };

    const s1 = summarize(map);
    const s2 = summarize(map);
    expect(s1).toBe(s2);
    expect(s1.length).toBeGreaterThan(0);
    expect(s1).toContain('TypeScript');
    expect(s1).toContain('my-pkg');
    expect(s1).toContain('src/index.ts');
  });

  it('respects maxLines', () => {
    const map: RepoMap = {
      rootDir: '/r', scannedAt: '2024-01-01T00:00:00.000Z', truncated: false,
      fileCount: 1, dirCount: 0, totalBytes: 10,
      languages: {}, packages: [], entryPoints: [], topLevel: [],
      documentationFiles: [], testDirs: [], configFiles: [],
    };
    const s = summarize(map, 2);
    expect(s.split('\n').length).toBeLessThanOrEqual(2);
  });
});

describe('subagentSpec', () => {
  it('returns an object with name, description, inputSchema, outputSchema', () => {
    const spec = subagentSpec();
    expect(spec.name).toBe('repo-mapper');
    expect(typeof spec.description).toBe('string');
    expect(spec.inputSchema).toBeDefined();
    expect(spec.outputSchema).toBeDefined();
  });

  it('is idempotent — two calls return equal shapes', () => {
    const a = subagentSpec();
    const b = subagentSpec();
    expect(a.name).toBe(b.name);
    expect(JSON.stringify(a.inputSchema)).toBe(JSON.stringify(b.inputSchema));
    expect(JSON.stringify(a.outputSchema)).toBe(JSON.stringify(b.outputSchema));
  });

  it('inputSchema has required rootDir', () => {
    const spec = subagentSpec() as { inputSchema: { required: string[] } };
    expect(spec.inputSchema.required).toContain('rootDir');
  });
});

// ====== RepoMapper.scan integration tests ======

describe('RepoMapper.scan', () => {
  const silentLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };

  it('returns truncated:false on the small fake repo', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });
    expect(result.truncated).toBe(false);
    expect(result.fileCount).toBeGreaterThan(0);
  });

  it('respects maxFiles → truncated:true', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir, maxFiles: 3 });
    expect(result.truncated).toBe(true);
    expect(result.fileCount).toBeLessThanOrEqual(3);
  });

  it('respects maxDepth — deep dirs not visited', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    // maxDepth=1: visits rootDir children (ts-pkg, py-pkg, rust-crate) but
    // does NOT recurse into their subdirs (src/, __tests__/, etc.)
    const result = await mapper.scan({ rootDir: tmpDir, maxDepth: 1 });

    // src/index.ts is 2 levels deep — must NOT appear
    const hasIndexTs = result.entryPoints.some(e => e.relPath.endsWith('index.ts'));
    expect(hasIndexTs).toBe(false);

    // But package manifests at depth-1 ARE found
    expect(result.packages.length).toBeGreaterThan(0);
  });

  it('includeHidden:false hides .secret', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir, includeHidden: false });
    const hasSecret = result.topLevel.some(e => e.name === '.secret');
    expect(hasSecret).toBe(false);
  });

  it('includeHidden:true reveals .secret', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir, includeHidden: true });
    const hasSecret = result.topLevel.some(e => e.name === '.secret');
    expect(hasSecret).toBe(true);
  });

  it('extraIgnore drops the specified dir', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir, extraIgnore: ['py-pkg'] });
    const hasPython = result.packages.some(p => p.manager === 'python');
    expect(hasPython).toBe(false);
  });

  it('packages[] contains all 3 manifests with correct manager and name', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const npm    = result.packages.find(p => p.manager === 'npm');
    const python = result.packages.find(p => p.manager === 'python');
    const cargo  = result.packages.find(p => p.manager === 'cargo');

    expect(npm).toBeDefined();
    expect(npm?.name).toBe('ts-pkg');

    expect(python).toBeDefined();
    expect(python?.name).toBe('py-pkg');

    expect(cargo).toBeDefined();
    expect(cargo?.name).toBe('rust-crate');
  });

  it('entryPoints includes src/index.ts (heuristic) and src/main.rs (heuristic)', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const hasIndex = result.entryPoints.some(
      e => e.relPath.replace(/\\/g, '/').endsWith('src/index.ts'),
    );
    const hasMain = result.entryPoints.some(
      e => e.relPath.replace(/\\/g, '/').endsWith('src/main.rs'),
    );

    expect(hasIndex).toBe(true);
    expect(hasMain).toBe(true);
  });

  it('documentationFiles includes README.md', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });
    const hasReadme = result.documentationFiles.some(f => f.endsWith('README.md'));
    expect(hasReadme).toBe(true);
  });

  it('testDirs includes __tests__ and tests', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const hasTests  = result.testDirs.some(d => d.replace(/\\/g, '/').endsWith('__tests__'));
    const hasTestsDir = result.testDirs.some(d => d.replace(/\\/g, '/').endsWith('tests'));
    expect(hasTests).toBe(true);
    expect(hasTestsDir).toBe(true);
  });

  it('configFiles includes tsconfig.json, package.json, Cargo.toml, pyproject.toml', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const names = result.configFiles.map(f => path.basename(f));
    expect(names).toContain('tsconfig.json');
    expect(names).toContain('package.json');
    expect(names).toContain('Cargo.toml');
    expect(names).toContain('pyproject.toml');
  });

  it('language percentages sum to ~100', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const sum = Object.values(result.languages).reduce((s, v) => s + v.percent, 0);
    // Allow 0.5 % rounding slack
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThanOrEqual(100.5);
  });

  it('node_modules is ignored', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });
    const result = await mapper.scan({ rootDir: tmpDir });

    const mentionsNodeModules = [
      ...result.configFiles,
      ...result.entryPoints.map(e => e.relPath),
      ...result.documentationFiles,
    ].some(p => p.includes('node_modules'));

    expect(mentionsNodeModules).toBe(false);
  });

  it('tolerates read errors on individual files — scan still completes', async () => {
    const mapper = new RepoMapper({ logger: silentLogger });

    // Stub readFile: throw for the ts-pkg package.json, pass-through for everything else
    const orig = fs.promises.readFile.bind(fs.promises);
    const spy  = vi.spyOn(fs.promises, 'readFile').mockImplementation(
      (p: Parameters<typeof fs.promises.readFile>[0], ...args: unknown[]) => {
        if (String(p).includes('ts-pkg') && String(p).endsWith('package.json')) {
          return Promise.reject(new Error('simulated read error'));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any)(p, ...args);
      },
    );

    try {
      const result = await mapper.scan({ rootDir: tmpDir });
      // Scan must still complete
      expect(result).toBeDefined();
      expect(result.fileCount).toBeGreaterThan(0);
      // py-pkg and rust-crate should still be detected
      expect(result.packages.some(p => p.manager === 'python')).toBe(true);
      expect(result.packages.some(p => p.manager === 'cargo')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('getDefaultIgnore returns the expected list', () => {
    const mapper = new RepoMapper();
    const ignore = mapper.getDefaultIgnore();
    expect(ignore).toContain('node_modules');
    expect(ignore).toContain('.git');
    expect(ignore).toContain('dist');
    expect(ignore).toContain('vendor');
  });
});
