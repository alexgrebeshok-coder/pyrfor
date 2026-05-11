import { describe, expect, it } from 'vitest';
import { createSandboxExecutor } from './sandbox-executor';
import { WasmSandboxBackend } from './wasm-sandbox-backend';

describe('WasmSandboxBackend', () => {
  it('reports backend as wasm', () => {
    expect(new WasmSandboxBackend().backend).toBe('wasm');
  });

  it('reports WebAssembly availability in Node.js', async () => {
    await expect(new WasmSandboxBackend().isAvailable()).resolves.toBe(true);
  });

  it('run() rejects with an explicit deferral error', async () => {
    await expect(
      new WasmSandboxBackend().run({ implPath: '/fake/tool.wasm', workdir: '/tmp' }),
    ).rejects.toThrow(/not yet implemented/i);
  });

  it('createSandboxExecutor("wasm") returns the wasm backend', async () => {
    const executor = await createSandboxExecutor('wasm');

    expect(executor.backend).toBe('wasm');
  });
});
