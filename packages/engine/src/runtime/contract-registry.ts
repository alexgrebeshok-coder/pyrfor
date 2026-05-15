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

export class ContractRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractRegistryError';
  }
}

const CONTRACT_REF_RE = /^([A-Z][A-Za-z0-9]*)@([1-9]\d*)$/;

export function parseContractRef(ref: string): ContractRef | null {
  const match = CONTRACT_REF_RE.exec(ref);
  if (!match) return null;
  const major = Number(match[2]);
  if (!Number.isSafeInteger(major) || major < 1) return null;
  return { ref, name: match[1]!, major };
}

export class ContractRegistry {
  private readonly entries = new Map<string, ContractRegistryEntry>();

  register(entry: Omit<ContractRegistryEntry, 'name' | 'major'> & Partial<Pick<ContractRegistryEntry, 'name' | 'major'>>): ContractRegistryEntry {
    const parsed = parseContractRef(entry.ref);
    if (!parsed) throw new ContractRegistryError(`ContractRegistry: invalid contract ref "${entry.ref}"`);
    if (this.entries.has(parsed.ref)) throw new ContractRegistryError(`ContractRegistry: duplicate contract ref "${parsed.ref}"`);
    const normalized: ContractRegistryEntry = {
      ...entry,
      ref: parsed.ref,
      name: parsed.name,
      major: parsed.major,
    };
    this.entries.set(parsed.ref, normalized);
    return { ...normalized };
  }

  get(ref: string): ContractRegistryEntry | undefined {
    const parsed = parseContractRef(ref);
    if (!parsed) return undefined;
    const entry = this.entries.get(parsed.ref);
    return entry ? { ...entry } : undefined;
  }

  has(ref: string): boolean {
    return this.get(ref) !== undefined;
  }

  list(options: { direction?: ContractDirection; blockId?: string } = {}): ContractRegistryEntry[] {
    return [...this.entries.values()]
      .filter((entry) => options.direction === undefined || entry.direction === options.direction)
      .filter((entry) => options.blockId === undefined || entry.blockId === options.blockId)
      .map((entry) => ({ ...entry }));
  }

  size(): number {
    return this.entries.size;
  }
}
