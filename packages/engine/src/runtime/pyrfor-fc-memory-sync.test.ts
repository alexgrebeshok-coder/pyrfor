/**
 * pyrfor-fc-memory-sync.test.ts — Tests for FC memory sync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { MemoryEntry, MemoryStore, MemoryQuery } from './memory-store';
import {
  loadFcMemorySnapshot,
  syncFcMemoryToStore,
  syncFcMemory,
  type FcMemorySnapshot,
  type FcMemorySyncOptions,
} from './pyrfor-fc-memory-sync';

// ─── Stub FS ─────────────────────────────────────────────────────────────────

class StubFs {
  private files = new Map<string, string>();

  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  existsSync(path: string): boolean {
    return this.files.has(path);
  }

  readFileSync(path: string, _enc: 'utf8'): string {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }
}

// ─── Stub MemoryStore ────────────────────────────────────────────────────────

class StubMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private nextId = 1;

  add(input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>): MemoryEntry {
    const id = `stub-${this.nextId++}`;
    const ts = new Date().toISOString();
    const entry: MemoryEntry = {
      id,
      kind: input.kind,
      text: input.text,
      source: input.source,
      scope: input.scope,
      tags: input.tags ?? [],
      weight: input.weight,
      applied_count: 0,
      created_at: ts,
      updated_at: ts,
      ...(input.expires_at ? { expires_at: input.expires_at } : {}),
    };
    this.entries.set(id, entry);
    return entry;
  }

  update(): MemoryEntry | null {
    throw new Error('Not implemented in stub');
  }

  get(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  delete(_id: string): boolean {
    throw new Error('Not implemented in stub');
  }

  query(q?: MemoryQuery): MemoryEntry[] {
    const entries = Array.from(this.entries.values());
    
    if (!q) return entries;
    
    let filtered = entries;
    
    if (q.scope !== undefined) {
      filtered = filtered.filter((e) => e.scope === q.scope);
    }
    
    if (q.kind !== undefined) {
      const kinds = Array.isArray(q.kind) ? q.kind : [q.kind];
      filtered = filtered.filter((e) => kinds.includes(e.kind));
    }
    
    if (q.tags && q.tags.length > 0) {
      filtered = filtered.filter((e) => 
        q.tags!.every((tag) => e.tags.includes(tag))
      );
    }
    
    if (q.limit !== undefined) {
      filtered = filtered.slice(0, q.limit);
    }
    
    return filtered;
  }

  search(): MemoryEntry[] {
    throw new Error('Not implemented in stub');
  }

  recordApplied(): void {
    throw new Error('Not implemented in stub');
  }

  prune(): number {
    throw new Error('Not implemented in stub');
  }

  count(): number {
    return this.entries.size;
  }

  close(): void {
    // no-op
  }

  exportAll(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  importMany(): number {
    throw new Error('Not implemented in stub');
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('loadFcMemorySnapshot', () => {
  it('loads memory and embeddings when both files exist', () => {
    const fs = new StubFs();
    
    fs.addFile('/test/memory.json', JSON.stringify({
      entries: {
        'name': {
          key: 'name',
          value: 'Sasha',
          createdAt: '2026-04-12T05:38:05.330Z',
          updatedAt: '2026-04-12T05:38:05.330Z',
          tags: ['personal'],
        },
        'age': {
          key: 'age',
          value: '30',
          createdAt: '2026-04-12T05:39:00.000Z',
          updatedAt: '2026-04-12T05:39:00.000Z',
        },
      },
    }));
    
    fs.addFile('/test/embeddings.json', JSON.stringify({
      model: 'text-embedding-ada-002',
      entries: [
        {
          key: 'name',
          value: 'Sasha',
          embedding: [0.1, 0.2, 0.3],
          updatedAt: '2026-04-12T05:38:05.330Z',
        },
      ],
    }));
    
    const snapshot = loadFcMemorySnapshot({
      memoryPath: '/test/memory.json',
      embeddingsPath: '/test/embeddings.json',
      fs,
      now: () => 1234567890,
    });
    
    expect(snapshot.memory).toHaveLength(2);
    expect(snapshot.memory[0].key).toBe('name');
    expect(snapshot.memory[0].value).toBe('Sasha');
    expect(snapshot.memory[0].tags).toEqual(['personal']);
    expect(snapshot.memory[1].key).toBe('age');
    
    expect(snapshot.embeddings).toHaveLength(1);
    expect(snapshot.embeddings[0].key).toBe('name');
    expect(snapshot.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3]);
    
    expect(snapshot.embeddingModel).toBe('text-embedding-ada-002');
    expect(snapshot.loadedAt).toBe(1234567890);
  });

  it('returns empty arrays when files are missing', () => {
    const fs = new StubFs();
    
    const snapshot = loadFcMemorySnapshot({
      memoryPath: '/nonexistent/memory.json',
      embeddingsPath: '/nonexistent/embeddings.json',
      fs,
      now: () => 9999,
    });
    
    expect(snapshot.memory).toEqual([]);
    expect(snapshot.embeddings).toEqual([]);
    expect(snapshot.embeddingModel).toBeUndefined();
    expect(snapshot.loadedAt).toBe(9999);
  });

  it('throws on malformed JSON in memory.json', () => {
    const fs = new StubFs();
    fs.addFile('/test/memory.json', '{ invalid json');
    
    expect(() => {
      loadFcMemorySnapshot({
        memoryPath: '/test/memory.json',
        embeddingsPath: '/test/embeddings.json',
        fs,
      });
    }).toThrow(/Malformed JSON in \/test\/memory\.json/);
  });

  it('throws on malformed JSON in embeddings.json', () => {
    const fs = new StubFs();
    fs.addFile('/test/memory.json', JSON.stringify({ entries: {} }));
    fs.addFile('/test/embeddings.json', '{ broken: }');
    
    expect(() => {
      loadFcMemorySnapshot({
        memoryPath: '/test/memory.json',
        embeddingsPath: '/test/embeddings.json',
        fs,
      });
    }).toThrow(/Malformed JSON in \/test\/embeddings\.json/);
  });

  it('handles unexpected entries shape with warning', () => {
    const fs = new StubFs();
    const warnSpy: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnSpy.push(args.join(' '));
    
    try {
      fs.addFile('/test/memory.json', JSON.stringify({
        entries: 'not an object or array',
      }));
      
      const snapshot = loadFcMemorySnapshot({
        memoryPath: '/test/memory.json',
        embeddingsPath: '/test/embeddings.json',
        fs,
      });
      
      expect(snapshot.memory).toEqual([]);
      expect(warnSpy.some(msg => msg.includes('Unexpected entries shape'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('tolerates missing fields per entry', () => {
    const fs = new StubFs();
    
    fs.addFile('/test/memory.json', JSON.stringify({
      entries: {
        'minimal': {
          key: 'minimal',
          value: 'just key and value',
        },
      },
    }));
    
    const snapshot = loadFcMemorySnapshot({
      memoryPath: '/test/memory.json',
      embeddingsPath: '/test/embeddings.json',
      fs,
    });
    
    expect(snapshot.memory).toHaveLength(1);
    expect(snapshot.memory[0].key).toBe('minimal');
    expect(snapshot.memory[0].value).toBe('just key and value');
    expect(snapshot.memory[0].tags).toBeUndefined();
    expect(snapshot.memory[0].updatedAt).toBeUndefined();
  });

  it('handles array format for entries', () => {
    const fs = new StubFs();
    
    fs.addFile('/test/memory.json', JSON.stringify({
      entries: [
        { key: 'item1', value: 'value1' },
        { key: 'item2', value: 'value2' },
      ],
    }));
    
    const snapshot = loadFcMemorySnapshot({
      memoryPath: '/test/memory.json',
      embeddingsPath: '/test/embeddings.json',
      fs,
    });
    
    expect(snapshot.memory).toHaveLength(2);
    expect(snapshot.memory[0].key).toBe('item1');
    expect(snapshot.memory[1].key).toBe('item2');
  });
});

describe('syncFcMemoryToStore', () => {
  it('syncs FC entries to MemoryStore', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'name', value: 'Sasha', tags: ['personal'] },
        { key: 'hobby', value: 'coding', tags: ['personal'] },
        { key: 'lesson1', value: 'always test', tags: ['lesson'] },
      ],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    const result = syncFcMemoryToStore(snapshot, {
      store,
      scope: 'fc-import',
      source: 'freeclaude',
    });
    
    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(3);
    expect(store.count()).toBe(3);
    
    const entries = store.exportAll();
    expect(entries[0].source).toBe('freeclaude#name');
    expect(entries[0].text).toBe('name: Sasha');
    expect(entries[0].kind).toBe('preference'); // tags: ['personal']
    expect(entries[0].scope).toBe('fc-import');
    expect(entries[0].tags).toEqual(['personal']);
    expect(entries[0].weight).toBe(1.0);
    
    expect(entries[1].source).toBe('freeclaude#hobby');
    expect(entries[1].kind).toBe('preference');
    
    expect(entries[2].source).toBe('freeclaude#lesson1');
    expect(entries[2].kind).toBe('lesson'); // tags: ['lesson']
  });

  it('is idempotent: re-running skips existing entries', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'name', value: 'Sasha', tags: ['personal'] },
        { key: 'hobby', value: 'coding' },
      ],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    const opts: FcMemorySyncOptions = {
      store,
      scope: 'fc-import',
      source: 'freeclaude',
    };
    
    // First sync
    const result1 = syncFcMemoryToStore(snapshot, opts);
    expect(result1.added).toBe(2);
    expect(result1.skipped).toBe(0);
    expect(store.count()).toBe(2);
    
    // Second sync (idempotent)
    const result2 = syncFcMemoryToStore(snapshot, opts);
    expect(result2.added).toBe(0);
    expect(result2.skipped).toBe(2);
    expect(result2.total).toBe(2);
    expect(store.count()).toBe(2); // no duplicates
  });

  it('infers kind from tags', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'pref', value: 'val', tags: ['personal'] },
        { key: 'lesson', value: 'val', tags: ['lesson'] },
        { key: 'fact', value: 'val', tags: ['other'] },
        { key: 'no-tags', value: 'val' },
      ],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    syncFcMemoryToStore(snapshot, { store });
    
    const entries = store.exportAll();
    expect(entries.find(e => e.source.includes('pref'))?.kind).toBe('preference');
    expect(entries.find(e => e.source.includes('lesson'))?.kind).toBe('lesson');
    expect(entries.find(e => e.source.includes('fact'))?.kind).toBe('fact');
    expect(entries.find(e => e.source.includes('no-tags'))?.kind).toBe('fact');
  });

  it('honors custom scope and source', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'test', value: 'value' },
      ],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    syncFcMemoryToStore(snapshot, {
      store,
      scope: 'custom-scope',
      source: 'custom-source',
    });
    
    const entries = store.exportAll();
    expect(entries[0].scope).toBe('custom-scope');
    expect(entries[0].source).toBe('custom-source#test');
  });

  it('uses default scope and source when not provided', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'test', value: 'value' },
      ],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    syncFcMemoryToStore(snapshot, { store });
    
    const entries = store.exportAll();
    expect(entries[0].scope).toBe('fc-import');
    expect(entries[0].source).toBe('freeclaude#test');
  });

  it('handles empty snapshot', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [],
      embeddings: [],
      loadedAt: Date.now(),
    };
    
    const result = syncFcMemoryToStore(snapshot, { store });
    
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(0);
    expect(store.count()).toBe(0);
  });

  it('preserves embeddings in snapshot', () => {
    const store = new StubMemoryStore();
    const snapshot: FcMemorySnapshot = {
      memory: [
        { key: 'name', value: 'Sasha' },
      ],
      embeddings: [
        { key: 'name', value: 'Sasha', embedding: [0.1, 0.2, 0.3] },
      ],
      embeddingModel: 'test-model',
      loadedAt: Date.now(),
    };
    
    syncFcMemoryToStore(snapshot, { store });
    
    // Embeddings are preserved in snapshot (not stored in MemoryStore)
    expect(snapshot.embeddings).toHaveLength(1);
    expect(snapshot.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(snapshot.embeddingModel).toBe('test-model');
  });
});

describe('syncFcMemory', () => {
  it('performs end-to-end load and sync', () => {
    const fs = new StubFs();
    const store = new StubMemoryStore();
    
    fs.addFile('/test/memory.json', JSON.stringify({
      entries: {
        'key1': { key: 'key1', value: 'value1', tags: ['personal'] },
        'key2': { key: 'key2', value: 'value2', tags: ['lesson'] },
      },
    }));
    
    fs.addFile('/test/embeddings.json', JSON.stringify({
      model: 'test-model',
      entries: [
        { key: 'key1', value: 'value1', embedding: [1, 2, 3] },
      ],
    }));
    
    const result = syncFcMemory({
      memoryPath: '/test/memory.json',
      embeddingsPath: '/test/embeddings.json',
      store,
      scope: 'test-scope',
      source: 'test-source',
      fs,
      now: () => 123456,
    });
    
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(2);
    expect(result.snapshot.memory).toHaveLength(2);
    expect(result.snapshot.embeddings).toHaveLength(1);
    expect(result.snapshot.embeddingModel).toBe('test-model');
    expect(result.snapshot.loadedAt).toBe(123456);
    
    expect(store.count()).toBe(2);
    
    const entries = store.exportAll();
    expect(entries[0].kind).toBe('preference');
    expect(entries[1].kind).toBe('lesson');
  });

  it('handles missing files gracefully', () => {
    const fs = new StubFs();
    const store = new StubMemoryStore();
    
    const result = syncFcMemory({
      memoryPath: '/nonexistent/memory.json',
      embeddingsPath: '/nonexistent/embeddings.json',
      store,
      fs,
    });
    
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(0);
    expect(result.snapshot.memory).toEqual([]);
    expect(result.snapshot.embeddings).toEqual([]);
    expect(store.count()).toBe(0);
  });
});
