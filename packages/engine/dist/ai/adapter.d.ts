import type { AIAdapter, AIAdapterMode } from './types';
export type ClientAIAdapterMode = Exclude<AIAdapterMode, "provider">;
export declare function createAIAdapter(mode: ClientAIAdapterMode): AIAdapter;
//# sourceMappingURL=adapter.d.ts.map