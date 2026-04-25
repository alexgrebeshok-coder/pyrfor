import { describe, it, expect } from 'vitest';
import { PtyManager } from '../manager.js';

describe('PtyManager', () => {
  it('spawns /bin/echo hello, collects data, fires exit', async () => {
    const manager = new PtyManager();
    const id = manager.spawn({ cwd: '/tmp', shell: '/bin/sh', cols: 80, rows: 24 });
    expect(typeof id).toBe('string');

    const chunks: string[] = [];
    manager.on('data', (ptyId: string, data: string) => {
      if (ptyId === id) chunks.push(data);
    });

    const exitPromise = new Promise<void>((resolve) => {
      manager.on('exit', (ptyId: string) => {
        if (ptyId === id) resolve();
      });
    });

    manager.write(id, 'echo hello\nexit\n');

    await exitPromise;
    const output = chunks.join('');
    expect(output).toContain('hello');
  });

  it('resize does not throw', () => {
    const manager = new PtyManager();
    const id = manager.spawn({ cwd: '/tmp', shell: '/bin/sh' });
    expect(() => manager.resize(id, 120, 40)).not.toThrow();
    manager.kill(id);
  });

  it('kill removes session', () => {
    const manager = new PtyManager();
    const id = manager.spawn({ cwd: '/tmp', shell: '/bin/sh' });
    manager.kill(id);
    expect(manager.list().find((s) => s.id === id)).toBeUndefined();
  });

  it('list returns sessions', () => {
    const manager = new PtyManager();
    const id = manager.spawn({ cwd: '/tmp', shell: '/bin/sh' });
    const list = manager.list();
    expect(list.some((s) => s.id === id)).toBe(true);
    manager.kill(id);
  });
});
