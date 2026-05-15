export interface ContractRef {
    ref: string;
    name: string;
    major: number;
}
export type ContractDirection = 'consumes' | 'produces';
export interface ContractRegistryEntry extends ContractRef {
    blockId: string;
    direction: ContractDirection;
    registeredAt: string;
    from?: string;
    optional?: boolean;
}
export declare class ContractRegistryError extends Error {
    constructor(message: string);
}
export declare function parseContractRef(ref: string): ContractRef | null;
export declare class ContractRegistry {
    private readonly entries;
    register(entry: Omit<ContractRegistryEntry, 'name' | 'major'> & Partial<Pick<ContractRegistryEntry, 'name' | 'major'>>): ContractRegistryEntry;
    get(ref: string): ContractRegistryEntry | undefined;
    has(ref: string): boolean;
    list(options?: {
        direction?: ContractDirection;
        blockId?: string;
    }): ContractRegistryEntry[];
    size(): number;
}
//# sourceMappingURL=contract-registry.d.ts.map