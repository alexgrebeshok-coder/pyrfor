import { createHash } from 'node:crypto';
import type {
  CompileContextInput,
  CompileContextResult,
  ContextCompiler,
} from '../../context-compiler';
import { hashContextPack, stableStringify, type ContextPackSection } from '../../context-pack';
import type { MemoryProvider } from './provider';

export interface ContextCompressor {
  readonly name: string;
  compress(sections: ContextPackSection[]): Promise<ContextPackSection[]>;
}

export interface ContextEngineOptions {
  compiler: ContextCompiler;
  compressors?: ContextCompressor[];
  memoryProvider?: MemoryProvider;
}

export class ContextEngine {
  private readonly compiler: ContextCompiler;
  private readonly memoryProvider: MemoryProvider | undefined;
  private readonly compressors: ContextCompressor[] = [];

  constructor(options: ContextEngineOptions) {
    this.compiler = options.compiler;
    this.memoryProvider = options.memoryProvider;
    this.compressors.push(...(options.compressors ?? []));
  }

  registerCompressor(compressor: ContextCompressor): void {
    this.compressors.push(compressor);
  }

  async compile(input: CompileContextInput): Promise<CompileContextResult> {
    const result = await this.compiler.compile(input);
    if (this.compressors.length === 0) return result;
    let sections = result.pack.sections;
    for (const compressor of this.compressors) {
      sections = await compressor.compress(sections);
    }
    const { hash: _oldHash, ...withoutHashBase } = result.pack;
    const withoutHash = {
      ...withoutHashBase,
      sections,
    };
    const hash = hashContextPack(withoutHash);
    return {
      ...result,
      hash,
      canonicalJson: stableStringify(withoutHash),
      pack: {
        ...result.pack,
        sections,
        hash,
      },
    };
  }

  getMemoryProvider(): MemoryProvider | undefined {
    return this.memoryProvider;
  }
}

export class TruncateBudgetCompressor implements ContextCompressor {
  readonly name = 'truncate-budget';

  constructor(private readonly maxSections: number) {}

  async compress(sections: ContextPackSection[]): Promise<ContextPackSection[]> {
    if (this.maxSections <= 0) return [];
    return [...sections]
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .slice(0, this.maxSections);
  }
}

export class DeduplicateCompressor implements ContextCompressor {
  readonly name = 'deduplicate';

  async compress(sections: ContextPackSection[]): Promise<ContextPackSection[]> {
    const seen = new Set<string>();
    const result: ContextPackSection[] = [];
    for (const section of sections) {
      const key = createHash('sha256').update(stableStringify(section.content)).digest('hex');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(section);
    }
    return result;
  }
}
