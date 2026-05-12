import * as vscode from 'vscode';
import { DaemonClient } from './daemon-client';
import { PyrforChatViewProvider } from './panels/chat-view';
import { ConceptTraceViewProvider } from './panels/concept-trace-view';
import { formatStatus } from './status-bar';
import { fetchExecutionMode, type ExecutionMode } from './execution-mode';
import { gatewayHttpBaseFromDaemonUrl, UniversalApiClient, type ConceptRecord } from './universal-api';
import { ConceptsTreeProvider, conceptFromTreeNode } from './views/concepts-tree';

let client: DaemonClient | null = null;
let activeConceptStream: { dispose(): void } | null = null;
const GATEWAY_TOKEN_SECRET_PREFIX = 'pyrfor.gatewayToken';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('pyrfor');
  let daemonUrl: string = config.get('daemonUrl') ?? 'ws://127.0.0.1:18790/';
  let gatewayUrl = configuredGatewayUrl(config, daemonUrl);
  let gatewayToken = await context.secrets.get(gatewayTokenSecretKey(gatewayUrl));
  const autoConnect: boolean = config.get('autoConnect') ?? true;
  let executionMode: ExecutionMode | undefined;
  let traceGeneration = 0;

  client = new DaemonClient(daemonUrl);
  let universalApi = new UniversalApiClient(gatewayUrl, gatewayToken);

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

  const refreshConcepts = async (): Promise<void> => {
    try {
      await conceptsProvider.refresh();
    } catch (err) {
      vscode.window.setStatusBarMessage(`Pyrfor Universal Engine unavailable: ${String(err)}`, 5000);
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

  const conceptsProvider = new ConceptsTreeProvider(universalApi);
  const conceptsTree = vscode.window.createTreeView('pyrfor.concepts', { treeDataProvider: conceptsProvider });
  const traceProvider = new ConceptTraceViewProvider(context.extensionUri);
  context.subscriptions.push(
    conceptsTree,
    vscode.window.registerWebviewViewProvider('pyrfor.trace', traceProvider),
  );

  const openTrace = async (concept: ConceptRecord): Promise<void> => {
    const generation = ++traceGeneration;
    activeConceptStream?.dispose();
    activeConceptStream = null;
    traceProvider.setConcept(concept);
    await vscode.commands.executeCommand('pyrfor.trace.focus');
    if (generation !== traceGeneration) return;
    const stream = await universalApi.streamConceptEvents(concept.conceptId, {
      onSnapshot: (snapshot) => {
        if (generation !== traceGeneration) return;
        const snapshotConcept = conceptFromSnapshot(snapshot);
        const events = eventsFromSnapshot(snapshot);
        if (snapshotConcept) {
          conceptsProvider.updateConcept(snapshotConcept);
          traceProvider.setConcept(snapshotConcept, events);
        }
      },
      onLedger: (event) => {
        if (generation !== traceGeneration) return;
        conceptsProvider.appendLedgerEvent(event);
        traceProvider.appendEvent(event);
      },
      onError: (error) => {
        if (generation === traceGeneration) {
          vscode.window.setStatusBarMessage(`Pyrfor concept stream: ${error.message}`, 5000);
        }
      },
    });
    if (generation !== traceGeneration) {
      stream.dispose();
      return;
    }
    activeConceptStream = stream;
  };

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
    }),

    vscode.commands.registerCommand('pyrfor.concept.start', async () => {
      const goal = await vscode.window.showInputBox({ prompt: 'Universal Engine concept/task' });
      if (!goal?.trim()) return;
      try {
        const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const handle = await universalApi.startConcept({ goal: goal.trim(), workspaceId });
        await refreshConcepts();
        vscode.window.showInformationMessage(`Pyrfor concept queued: ${handle.conceptId}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Pyrfor Universal Engine: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('pyrfor.concept.status', async () => {
      await refreshConcepts();
    }),

    vscode.commands.registerCommand('pyrfor.concept.abort', async (node?: unknown) => {
      const concept = conceptFromTreeNode(node as Parameters<typeof conceptFromTreeNode>[0])
        ?? conceptFromTreeNode(conceptsTree.selection[0] as Parameters<typeof conceptFromTreeNode>[0]);
      if (!concept) {
        vscode.window.showWarningMessage('Select a Pyrfor concept first.');
        return;
      }
      const decision = await vscode.window.showWarningMessage(
        `Abort Pyrfor concept ${concept.conceptId}?`,
        { modal: true },
        'Abort',
      );
      if (decision !== 'Abort') return;
      try {
        await universalApi.abortConcept(concept.conceptId);
        await refreshConcepts();
      } catch (err) {
        vscode.window.showErrorMessage(`Pyrfor Universal Engine: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('pyrfor.concept.openTrace', async (node?: unknown) => {
      const concept = conceptFromTreeNode(node as Parameters<typeof conceptFromTreeNode>[0])
        ?? conceptFromTreeNode(conceptsTree.selection[0] as Parameters<typeof conceptFromTreeNode>[0]);
      if (!concept) {
        vscode.window.showWarningMessage('Select a Pyrfor concept first.');
        return;
      }
      await openTrace(concept);
    }),

    vscode.commands.registerCommand('pyrfor.gateway.setToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Pyrfor gateway bearer token',
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) return;
      if (!token.trim()) {
        await context.secrets.delete(gatewayTokenSecretKey(gatewayUrl));
        gatewayToken = undefined;
      } else {
        await context.secrets.store(gatewayTokenSecretKey(gatewayUrl), token.trim());
        gatewayToken = token.trim();
      }
      universalApi = new UniversalApiClient(gatewayUrl, gatewayToken);
      conceptsProvider.setApi(universalApi);
      await refreshConcepts();
    }),

    vscode.commands.registerCommand('pyrfor.gateway.clearToken', async () => {
      await context.secrets.delete(gatewayTokenSecretKey(gatewayUrl));
      gatewayToken = undefined;
      universalApi = new UniversalApiClient(gatewayUrl, gatewayToken);
      conceptsProvider.setApi(universalApi);
      await refreshConcepts();
    })
  );

  // Re-connect when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('pyrfor')) return;
      const newConfig = vscode.workspace.getConfiguration('pyrfor');
      const newUrl: string = newConfig.get('daemonUrl') ?? 'ws://127.0.0.1:18790/';
      const newGatewayUrl = configuredGatewayUrl(newConfig, newUrl);
      client?.disconnect();
      traceGeneration++;
      activeConceptStream?.dispose();
      activeConceptStream = null;
      daemonUrl = newUrl;
      gatewayUrl = newGatewayUrl;
      gatewayToken = await context.secrets.get(gatewayTokenSecretKey(gatewayUrl));
      executionMode = undefined;
      client = new DaemonClient(newUrl);
      universalApi = new UniversalApiClient(gatewayUrl, gatewayToken);
      conceptsProvider.setApi(universalApi);
      chatProvider.setClient(client);
      bindClientEvents(client);
      updateStatusBar();
      void refreshConcepts();
      const newAuto: boolean = newConfig.get('autoConnect') ?? true;
      if (newAuto) {
        client.connect().catch(() => { /* handled by error event */ });
      }
    })
  );

  if (autoConnect) {
    client.connect().catch(() => { /* handled by error event */ });
  }

  void refreshConcepts();
}

export function deactivate(): void {
  activeConceptStream?.dispose();
  activeConceptStream = null;
  client?.disconnect();
  client = null;
}

function conceptFromSnapshot(snapshot: unknown): ConceptRecord | undefined {
  if (!isRecord(snapshot)) return undefined;
  return isConceptRecord(snapshot.concept) ? snapshot.concept : undefined;
}

function eventsFromSnapshot(snapshot: unknown): unknown[] {
  if (!isRecord(snapshot)) return [];
  return Array.isArray(snapshot.events) ? snapshot.events : [];
}

function isConceptRecord(value: unknown): value is ConceptRecord {
  return (
    isRecord(value) &&
    typeof value.conceptId === 'string' &&
    typeof value.goal === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.phases) &&
    typeof value.createdAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configuredGatewayUrl(config: vscode.WorkspaceConfiguration, daemonUrl: string): string {
  const explicit = config.get<string>('gatewayUrl');
  return explicit?.trim() ? explicit.trim().replace(/\/$/, '') : gatewayHttpBaseFromDaemonUrl(daemonUrl);
}

function gatewayTokenSecretKey(gatewayUrl: string): string {
  try {
    return `${GATEWAY_TOKEN_SECRET_PREFIX}:${new URL(gatewayUrl).origin}`;
  } catch {
    return `${GATEWAY_TOKEN_SECRET_PREFIX}:http://127.0.0.1:18790`;
  }
}
