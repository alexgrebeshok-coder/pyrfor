import { describe, expect, it } from 'vitest';
import type { CompileContextInput, CompileContextResult, ContextCompiler } from '../../context-compiler';
import type { ContextPack, ContextPackSection } from '../../context-pack';
import { stableStringify, withContextPackHash } from '../../context-pack';
import {
  ContextEngine,
  DeduplicateCompressor,
  TruncateBudgetCompressor,
} from './context-engine';

describe('ContextEngine compressors', () => {
  it('TruncateBudgetCompressor keeps top-N sections by priority', async () => {
    const compressor = new TruncateBudgetCompressor(3);
    const result = await compressor.compress([
      section('low', 1, 'a'),
      section('high', 10, 'b'),
      section('mid', 5, 'c'),
      section('tie-b', 8, 'd'),
      section('tie-a', 8, 'e'),
    ]);

    expect(result.map((item) => item.id)).toEqual(['high', 'tie-a', 'tie-b']);
  });

  it('TruncateBudgetCompressor keeps all sections when under budget', async () => {
    const compressor = new TruncateBudgetCompressor(5);

    const result = await compressor.compress([section('a', 1), section('b', 2)]);

    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('DeduplicateCompressor removes sections with identical stable content', async () => {
    const compressor = new DeduplicateCompressor();

    const result = await compressor.compress([
      section('a', 3, { one: 1, two: 2 }),
      section('b', 2, { two: 2, one: 1 }),
      section('c', 1, { three: 3 }),
    ]);

    expect(result.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('DeduplicateCompressor keeps all unique sections', async () => {
    const compressor = new DeduplicateCompressor();

    const result = await compressor.compress([
      section('a', 3, 'a'),
      section('b', 2, 'b'),
      section('c', 1, 'c'),
    ]);

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('chains compressors in order and refreshes pack hash/canonical JSON', async () => {
    const compiler = new FakeCompiler([
      section('a', 3, 'dup'),
      section('b', 2, 'dup'),
      section('c', 1, 'unique'),
    ]);
    const engine = new ContextEngine({
      compiler,
      compressors: [new TruncateBudgetCompressor(2), new DeduplicateCompressor()],
    });

    const result = await engine.compile(input());

    expect(result.pack.sections.map((item) => item.id)).toEqual(['a']);
    expect(result.hash).toBe(result.pack.hash);
    expect(result.canonicalJson).toContain('"sections"');
    expect(result.canonicalJson).not.toContain('"hash"');
  });

  it('registerCompressor appends compressors after construction', async () => {
    const compiler = new FakeCompiler([section('a', 1), section('b', 2)]);
    const engine = new ContextEngine({ compiler });

    engine.registerCompressor(new TruncateBudgetCompressor(1));
    const result = await engine.compile(input());

    expect(result.pack.sections.map((item) => item.id)).toEqual(['b']);
  });

  it('returns compiler result unchanged when no compressors are registered', async () => {
    const compiler = new FakeCompiler([section('a', 1), section('b', 2)]);
    const engine = new ContextEngine({ compiler });
    const raw = await compiler.compile(input());

    const result = await engine.compile(input());

    expect(result).toEqual(raw);
  });
});

function input(): CompileContextInput {
  return {
    workspaceId: 'workspace-1',
    task: { title: 'Compress context' },
    compiledAt: '2026-05-11T00:00:00.000Z',
  };
}

function section(id: string, priority: number, content: unknown = id): ContextPackSection {
  return {
    id,
    kind: 'memory',
    title: id,
    priority,
    content,
    sources: [],
  };
}

class FakeCompiler implements ContextCompiler {
  constructor(private readonly sections: ContextPackSection[]) {}

  async compile(inputValue: CompileContextInput): Promise<CompileContextResult> {
    const pack = withContextPackHash({
      schemaVersion: 'context_pack.v1',
      packId: 'ctx:test',
      compiledAt: inputValue.compiledAt ?? '2026-05-11T00:00:00.000Z',
      workspaceId: inputValue.workspaceId,
      task: inputValue.task,
      sections: this.sections,
      sourceRefs: [],
    });
    return {
      pack,
      hash: pack.hash,
      canonicalJson: stableStringify(withoutHash(pack)),
    };
  }
}

function withoutHash(pack: ContextPack): Omit<ContextPack, 'hash'> {
  const { hash: _hash, ...rest } = pack;
  return rest;
}
