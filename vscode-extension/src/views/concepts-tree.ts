import * as vscode from 'vscode';
import type { ConceptRecord, PhaseSummary, UniversalApiClient } from '../universal-api';

type ConceptTreeNode =
  | { kind: 'concept'; concept: ConceptRecord }
  | { kind: 'phase'; conceptId: string; phase: PhaseSummary };

export class ConceptsTreeProvider implements vscode.TreeDataProvider<ConceptTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConceptTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private concepts: ConceptRecord[] = [];
  private phasesByConcept = new Map<string, PhaseSummary[]>();

  constructor(private api: UniversalApiClient) {}

  setApi(api: UniversalApiClient): void {
    this.api = api;
    this.concepts = [];
    this.phasesByConcept.clear();
    this._onDidChangeTreeData.fire();
  }

  async refresh(): Promise<void> {
    this.concepts = await this.api.listConcepts();
    this.phasesByConcept.clear();
    this._onDidChangeTreeData.fire();
  }

  updateConcept(concept: ConceptRecord): void {
    const idx = this.concepts.findIndex((item) => item.conceptId === concept.conceptId);
    if (idx === -1) this.concepts = [concept, ...this.concepts];
    else this.concepts = this.concepts.map((item, i) => (i === idx ? concept : item));
    this.phasesByConcept.delete(concept.conceptId);
    this._onDidChangeTreeData.fire();
  }

  appendLedgerEvent(event: unknown): void {
    if (!isRecord(event)) return;
    const conceptId = stringField(event, 'concept_id') ?? stringField(event, 'conceptId');
    if (!conceptId) return;
    const status = statusFromEvent(event);
    if (!status) return;
    const concept = this.concepts.find((item) => item.conceptId === conceptId);
    if (!concept) return;
    this.phasesByConcept.delete(conceptId);
    this.updateConcept({ ...concept, status });
  }

  async loadPhases(conceptId: string): Promise<void> {
    this.phasesByConcept.set(conceptId, await this.api.getPhases(conceptId));
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConceptTreeNode): vscode.TreeItem {
    if (element.kind === 'phase') {
      const item = new vscode.TreeItem(
        `${iconForPhaseStatus(element.phase.status)} ${element.phase.phase}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = element.phase.status;
      item.contextValue = 'pyrforPhase';
      return item;
    }

    const concept = element.concept;
    const item = new vscode.TreeItem(
      concept.goal || concept.conceptId,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = concept.conceptId;
    item.description = `${concept.status}${concept.currentPhase ? ` · ${concept.currentPhase}` : ''}`;
    item.tooltip = [
      `Concept: ${concept.conceptId}`,
      `Run: ${concept.runId}`,
      `Status: ${concept.status}`,
      concept.currentPhase ? `Current phase: ${concept.currentPhase}` : undefined,
    ].filter(Boolean).join('\n');
    item.contextValue = terminalStatuses.has(concept.status) ? 'pyrforConceptTerminal' : 'pyrforConcept';
    item.command = {
      command: 'pyrfor.concept.openTrace',
      title: 'Open Concept Trace',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: ConceptTreeNode): Promise<ConceptTreeNode[]> {
    if (!element) {
      return this.concepts.map((concept) => ({ kind: 'concept', concept }));
    }
    if (element.kind === 'phase') return [];
    if (!this.phasesByConcept.has(element.concept.conceptId)) {
      await this.loadPhases(element.concept.conceptId);
    }
    return (this.phasesByConcept.get(element.concept.conceptId) ?? []).map((phase) => ({
      kind: 'phase',
      conceptId: element.concept.conceptId,
      phase,
    }));
  }
}

export function conceptFromTreeNode(node: ConceptTreeNode | undefined): ConceptRecord | undefined {
  return node?.kind === 'concept' ? node.concept : undefined;
}

const terminalStatuses = new Set(['done', 'failed', 'aborted']);

function statusFromEvent(event: Record<string, unknown>): ConceptRecord['status'] | undefined {
  const type = stringField(event, 'type');
  if (type === 'concept.completed' && typeof event.status === 'string') return event.status;
  if (type === 'concept.completed') return 'done';
  if (type === 'concept.failed' || type === 'run.failed') return 'failed';
  if (type === 'concept.aborted' || type === 'run.cancelled') return 'aborted';
  if (type === 'concept.started') return 'planning';
  return undefined;
}

function iconForPhaseStatus(status: string): string {
  if (status === 'current') return '$(sync~spin)';
  if (status === 'completed') return '$(check)';
  return '$(circle-outline)';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}
