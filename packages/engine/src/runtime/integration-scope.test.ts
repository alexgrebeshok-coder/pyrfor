// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createTelegramConnector } from '../connectors/adapters/telegram';
import { getOneCODataSnapshot } from '../connectors/one-c-odata';
import { buildCeoclawMcpFc } from './pyrfor-ceoclaw-mcp-fc';
import { defaultProfileFor } from './freeclaude-mode';

describe('optional integration scope', () => {
  const readIfExists = (url: URL): string | null => existsSync(url) ? readFileSync(url, 'utf-8') : null;

  it('Telegram adapter stays pending without env and does not hit network', async () => {
    const fetchImpl = vi.fn();
    const status = await createTelegramConnector({}, fetchImpl as never).getStatus();

    expect(status).toMatchObject({
      id: 'telegram',
      configured: false,
      status: 'pending',
      missingSecrets: ['TELEGRAM_BOT_TOKEN'],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('1C OData adapter stays pending without env and does not hit network', async () => {
    const fetchImpl = vi.fn();
    const snapshot = await getOneCODataSnapshot({}, fetchImpl as never);

    expect(snapshot).toMatchObject({
      id: 'one-c-odata',
      configured: false,
      status: 'pending',
    });
    expect(snapshot.missingSecrets).toContain('ONE_C_ODATA_URL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CEOClaw MCP bridge is in-process and client-injected', async () => {
    const client = {
      getTask: vi.fn().mockResolvedValue({ taskId: 't1', title: 'Task', status: 'open' }),
      listTasks: vi.fn().mockResolvedValue([{ taskId: 't1', title: 'Task', status: 'open' }]),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = buildCeoclawMcpFc({ client });

    expect(bridge.toFcMcpConfigEntry()).toMatchObject({
      name: 'pyrfor-ceoclaw-mcp-fc',
      config: { command: '__in_process__' },
    });
    await expect(bridge.tools[0].handler({ taskId: 't1' })).resolves.toMatchObject({ taskId: 't1' });
    expect(client.getTask).toHaveBeenCalledWith('t1');
  });

  it('FreeClaude mode is a runtime mode profile, not a startup dependency', () => {
    expect(defaultProfileFor('chat')).toMatchObject({
      permissionProfile: 'standard',
      budgetProfile: { maxRunSeconds: 600 },
    });
    expect(defaultProfileFor('autonomous')).toMatchObject({
      permissionProfile: 'autonomous',
      budgetProfile: { maxRunSeconds: 3600 },
    });
  });

  it('canonical runtime index does not re-export optional integration adapters', () => {
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8');

    expect(indexSource).not.toContain("export * from './pyrfor-fc-adapter'");
    expect(indexSource).not.toContain("export * from './pyrfor-ceoclaw-mcp-fc'");
    expect(indexSource).not.toContain("export * from './pyrfor-mcp-server-fc'");
  });

  it('runtime CLI lazy-loads Telegram-only modules inside Telegram mode', () => {
    const cliSource = readFileSync(new URL('./cli.ts', import.meta.url), 'utf-8');
    const topLevelSource = cliSource.split('async function runTelegram')[0];

    expect(topLevelSource).not.toContain("from './telegram/");
    expect(topLevelSource).not.toContain("from './voice'");
    expect(topLevelSource).not.toContain("from './media/process-photo'");
    expect(topLevelSource).not.toContain("from './media/process-document'");
  });

  it('shipped runtime artifacts mirror optional integration boundaries when built', () => {
    const distIndex = readIfExists(new URL('../../dist/runtime/index.js', import.meta.url));
    const distCli = readIfExists(new URL('../../dist/runtime/cli.js', import.meta.url));
    const distIntegrationEntry = new URL('../../dist/runtime/integrations.js', import.meta.url);

    if (!distIndex || !distCli) return;

    expect(existsSync(distIntegrationEntry)).toBe(true);
    expect(distIndex).not.toContain("from './pyrfor-fc-adapter'");
    expect(distIndex).not.toContain("from './pyrfor-ceoclaw-mcp-fc'");
    expect(distIndex).not.toContain("from './pyrfor-mcp-server-fc'");
    const topLevelDistCli = distCli.split('async function runTelegram')[0];
    expect(topLevelDistCli).not.toContain("from './telegram/");
    expect(topLevelDistCli).not.toContain("from './voice'");
    expect(topLevelDistCli).not.toContain("from './media/process-photo'");
    expect(topLevelDistCli).not.toContain("from './media/process-document'");
  });
});
