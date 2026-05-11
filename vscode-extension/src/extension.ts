import * as vscode from 'vscode';
import { DaemonClient } from './daemon-client';
import { PyrforChatViewProvider } from './panels/chat-view';
import { formatStatus } from './status-bar';
import { fetchExecutionMode, type ExecutionMode } from './execution-mode';

let client: DaemonClient | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('pyrfor');
  let daemonUrl: string = config.get('daemonUrl') ?? 'ws://127.0.0.1:18790/';
  const autoConnect: boolean = config.get('autoConnect') ?? true;
  let executionMode: ExecutionMode | undefined;

  client = new DaemonClient(daemonUrl);

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(plug) Pyrfor: connecting…';
  statusBarItem.tooltip = 'Pyrfor daemon';
  statusBarItem.command = 'pyrfor.connect';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = (): void => {
    if (!client) return;
    const { text, tooltip } = formatStatus(client.state, executionMode);
    statusBarItem.text = text;
    statusBarItem.tooltip = tooltip;
  };

  const refreshExecutionMode = async (): Promise<void> => {
    const requestUrl = daemonUrl;
    try {
      const mode = await fetchExecutionMode(requestUrl);
      if (requestUrl === daemonUrl) {
        executionMode = mode;
        updateStatusBar();
      }
    } catch {
      if (requestUrl === daemonUrl) {
        executionMode = undefined;
        updateStatusBar();
      }
    }
  };

  const bindClientEvents = (activeClient: DaemonClient): void => {
    activeClient.on('stateChange', () => {
      updateStatusBar();
      if (activeClient.state === 'open') {
        void refreshExecutionMode();
      }
    });
    activeClient.on('message', (msg: unknown) => {
      chatProvider.postMessage({ type: 'daemonMessage', payload: msg });
    });
  };

  // Chat view provider
  const chatProvider = new PyrforChatViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('pyrfor.chat', chatProvider)
  );

  bindClientEvents(client);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pyrfor.connect', async () => {
      if (!client) return;
      try {
        await client.connect();
      } catch (err) {
        vscode.window.showErrorMessage(`Pyrfor: failed to connect — ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('pyrfor.disconnect', () => {
      client?.disconnect();
    }),

    vscode.commands.registerCommand('pyrfor.openChat', () => {
      vscode.commands.executeCommand('pyrfor.chat.focus');
    }),

    vscode.commands.registerCommand('pyrfor.sendMessage', async () => {
      const text = await vscode.window.showInputBox({ prompt: 'Message to Pyrfor daemon' });
      if (text === undefined || text === '') return;
      try {
        client?.send({ type: 'message', text });
      } catch (err) {
        vscode.window.showErrorMessage(`Pyrfor: ${String(err)}`);
      }
    })
  );

  // Re-connect when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('pyrfor')) return;
      const newConfig = vscode.workspace.getConfiguration('pyrfor');
      const newUrl: string = newConfig.get('daemonUrl') ?? 'ws://127.0.0.1:18790/';
      client?.disconnect();
      daemonUrl = newUrl;
      executionMode = undefined;
      client = new DaemonClient(newUrl);
      chatProvider.setClient(client);
      bindClientEvents(client);
      updateStatusBar();
      const newAuto: boolean = newConfig.get('autoConnect') ?? true;
      if (newAuto) {
        client.connect().catch(() => { /* handled by error event */ });
      }
    })
  );

  if (autoConnect) {
    client.connect().catch(() => { /* handled by error event */ });
  }
}

export function deactivate(): void {
  client?.disconnect();
  client = null;
}
