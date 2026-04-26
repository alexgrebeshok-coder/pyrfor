import * as vscode from 'vscode';
import { DaemonClient } from '../daemon-client';

export class PyrforChatViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _client: DaemonClient;
  private readonly _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri, client: DaemonClient) {
    this._extensionUri = extensionUri;
    this._client = client;
  }

  setClient(client: DaemonClient): void {
    this._client = client;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      if (!isWebviewMessage(msg)) return;
      if (msg.type === 'send') {
        try {
          this._client.send({ type: 'message', text: msg.text });
        } catch (err) {
          this._view?.webview.postMessage({
            type: 'error',
            text: String(err),
          });
        }
      }
    });
  }

  postMessage(msg: object): void {
    this._view?.webview.postMessage(msg);
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pyrfor Chat</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; padding: 8px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    #log { flex: 1; overflow-y: auto; border: 1px solid var(--vscode-input-border); padding: 6px; margin-bottom: 6px; }
    .msg { margin: 2px 0; }
    .msg.user { color: var(--vscode-textLink-foreground); }
    .msg.daemon { color: var(--vscode-foreground); }
    .msg.error { color: var(--vscode-errorForeground); }
    #form { display: flex; gap: 4px; }
    #input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; }
    #send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
    #send:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div id="log"></div>
  <form id="form">
    <input id="input" type="text" placeholder="Type a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const form = document.getElementById('form');

    function appendMsg(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      appendMsg('You: ' + text, 'user');
      vscode.postMessage({ type: 'send', text });
      input.value = '';
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'daemonMessage') {
        appendMsg('Daemon: ' + JSON.stringify(msg.payload), 'daemon');
      } else if (msg.type === 'error') {
        appendMsg('Error: ' + msg.text, 'error');
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

interface WebviewMessage {
  type: string;
  text: string;
}

function isWebviewMessage(val: unknown): val is WebviewMessage {
  return (
    typeof val === 'object' &&
    val !== null &&
    'type' in val &&
    typeof (val as Record<string, unknown>).type === 'string' &&
    'text' in val &&
    typeof (val as Record<string, unknown>).text === 'string'
  );
}
