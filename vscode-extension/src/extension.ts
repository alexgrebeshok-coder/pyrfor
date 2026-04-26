import * as vscode from 'vscode';
import { DaemonClient } from './daemon-client';
import { PyrforChatViewProvider } from './panels/chat-view';
import { formatStatus } from './status-bar';

let client: DaemonClient | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('pyrfor');
  const daemonUrl: string = config.get('daemonUrl') ?? 'ws://127.0.0.1:18790/';
  const autoConnect: boolean = config.get('autoConnect') ?? true;

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
    const { text, tooltip } = formatStatus(client.state);
    statusBarItem.text = text;
    statusBarItem.tooltip = tooltip;
  };

  client.on('stateChange', updateStatusBar);

  // Chat view provider
  const chatProvider = new PyrforChatViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('pyrfor.chat', chatProvider)
  );

  // Forward daemon messages to the webview
  client.on('message', (msg: unknown) => {
    chatProvider.postMessage({ type: 'daemonMessage', payload: msg });
  });

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
      client = new DaemonClient(newUrl);
      client.on('stateChange', updateStatusBar);
      client.on('message', (msg: unknown) => {
        chatProvider.postMessage({ type: 'daemonMessage', payload: msg });
      });
      chatProvider.setClient(client);
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
