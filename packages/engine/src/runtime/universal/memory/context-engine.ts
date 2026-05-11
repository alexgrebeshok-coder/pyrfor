import type {
  CompileContextInput,
  CompileContextResult,
  ContextCompiler,
} from '../../context-compiler';
import type { ContextPackSection } from '../../context-pack';
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
    return {
      ...result,
      pack: {
        ...result.pack,
        sections,
      },
    };
  }

  getMemoryProvider(): MemoryProvider | undefined {
    return this.memoryProvider;
  }
}
