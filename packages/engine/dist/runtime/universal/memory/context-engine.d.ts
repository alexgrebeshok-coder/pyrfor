import type { CompileContextInput, CompileContextResult, ContextCompiler } from '../../context-compiler';
import { type ContextPackSection } from '../../context-pack';
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
export declare class ContextEngine {
    private readonly compiler;
    private readonly memoryProvider;
    private readonly compressors;
    constructor(options: ContextEngineOptions);
    registerCompressor(compressor: ContextCompressor): void;
    compile(input: CompileContextInput): Promise<CompileContextResult>;
    getMemoryProvider(): MemoryProvider | undefined;
}
export declare class TruncateBudgetCompressor implements ContextCompressor {
    private readonly maxSections;
    readonly name = "truncate-budget";
    constructor(maxSections: number);
    compress(sections: ContextPackSection[]): Promise<ContextPackSection[]>;
}
export declare class DeduplicateCompressor implements ContextCompressor {
    readonly name = "deduplicate";
    compress(sections: ContextPackSection[]): Promise<ContextPackSection[]>;
}
//# sourceMappingURL=context-engine.d.ts.map