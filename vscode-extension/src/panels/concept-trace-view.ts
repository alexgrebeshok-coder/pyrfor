import * as vscode from 'vscode';
import type { ConceptRecord } from '../universal-api';

export class ConceptTraceViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private concept: ConceptRecord | undefined;
  private events: unknown[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    this.render();
  }

  setConcept(concept: ConceptRecord, events: unknown[] = []): void {
    this.concept = concept;
    this.events = events;
    this.render();
  }

  appendEvent(event: unknown): void {
    this.events = [...this.events, event].slice(-100);
    this.render();
  }

  clear(): void {
    this.concept = undefined;
    this.events = [];
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const nonce = getNonce();
    this.view.webview.html = html(nonce, this.concept, this.events);
  }
}

function html(nonce: string, concept: ConceptRecord | undefined, events: unknown[]): string {
  const mermaid = concept ? buildMermaidTrace(concept, events) : 'graph TD\n  empty[No concept selected]';
  const eventRows = events.map((event) => `<li><code>${escapeHtml(eventLabel(event))}</code></li>`).join('');
  const title = concept ? `${concept.goal} (${concept.status})` : 'Select a Universal Engine concept';
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pyrfor Concept Trace</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; padding: 10px; }
    h2 { font-size: 13px; margin: 0 0 8px; }
    pre { white-space: pre-wrap; border: 1px solid var(--vscode-input-border); padding: 8px; overflow: auto; background: var(--vscode-editor-background); }
    ul { padding-left: 18px; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
  <h2>${escapeHtml(title)}</h2>
  <pre>${escapeHtml(mermaid)}</pre>
  <h2>Live SSE events</h2>
  <ul>${eventRows || '<li>No events yet.</li>'}</ul>
  <script nonce="${nonce}"></script>
</body>
</html>`;
}

export function buildMermaidTrace(concept: ConceptRecord, events: unknown[]): string {
  const phases = concept.phases.length > 0
    ? concept.phases
    : ['plan', 'research', 'execute', 'critique', 'done'];
  const lines = ['graph TD'];
  lines.push(`  concept["${escapeMermaid(concept.conceptId)}"]`);
  phases.forEach((phase, index) => {
    const node = nodeId(phase, index);
    const label = phase === concept.currentPhase ? `${phase} (current)` : phase;
    lines.push(`  ${node}["${escapeMermaid(label)}"]`);
    lines.push(index === 0 ? `  concept --> ${node}` : `  ${nodeId(phases[index - 1], index - 1)} --> ${node}`);
  });
  for (const [index, event] of events.slice(-12).entries()) {
    lines.push(`  event${index}["${escapeMermaid(eventLabel(event))}"]`);
    lines.push(`  concept -.-> event${index}`);
  }
  return lines.join('\n');
}

function nodeId(phase: string, index: number): string {
  return `phase${index}_${phase.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function eventLabel(event: unknown): string {
  if (typeof event === 'string') return event;
  if (typeof event !== 'object' || event === null) return JSON.stringify(event);
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : 'event';
  const phase = typeof record.phase === 'string' ? ` · ${record.phase}` : '';
  return `${type}${phase}`;
}

function escapeMermaid(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
