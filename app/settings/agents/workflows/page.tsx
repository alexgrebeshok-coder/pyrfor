"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  GitBranch,
  Play,
  Plus,
  Save,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AgentOption = {
  id: string;
  name: string;
  role: string;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: number;
  status: string;
  updatedAt: string;
  definitionJson: {
    nodes: Array<{
      id: string;
      name: string;
      kind: "agent" | "approval";
      agentId?: string;
      dependsOn?: string[];
      taskTemplate?: string;
      approval?: {
        title: string;
        description?: string;
      };
    }>;
    outputNodes?: string[];
  };
};

type WorkflowRun = {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  template: {
    id: string;
    name: string;
    version: number;
  };
  summary: Record<string, number>;
};

const SAMPLE_DEFINITION = `{
  "outputNodes": ["final-review"],
  "nodes": [
    {
      "id": "design-scope",
      "name": "Scope and architecture",
      "kind": "agent",
      "agentId": "",
      "taskTemplate": "Analyse request: {{input}}. Produce architecture, constraints, and execution notes.",
      "maxRetries": 2
    },
    {
      "id": "implementation",
      "name": "Implementation",
      "kind": "agent",
      "agentId": "",
      "dependsOn": ["design-scope"],
      "taskTemplate": "Implement based on the design:\\n\\n{{design-scope}}",
      "maxRetries": 2
    },
    {
      "id": "manual-gate",
      "name": "Approval gate",
      "kind": "approval",
      "dependsOn": ["implementation"],
      "approval": {
        "title": "Approve release candidate for {{implementation}}",
        "description": "Review the generated result and approve the workflow to continue."
      }
    },
    {
      "id": "final-review",
      "name": "Final review",
      "kind": "agent",
      "agentId": "",
      "dependsOn": ["manual-gate"],
      "taskTemplate": "Create final summary and release notes using implementation output:\\n\\n{{implementation}}"
    }
  ]
}`;

const STATUS_VARIANTS: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
  queued: "neutral",
  running: "info",
  waiting_approval: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
};

export default function WorkflowBuilderPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  const [creatingNew, setCreatingNew] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("active");
  const [definitionText, setDefinitionText] = useState(SAMPLE_DEFINITION);
  const [workflowInput, setWorkflowInput] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [templatesRes, runsRes, agentsRes] = await Promise.all([
        fetch("/api/orchestration/workflows"),
        fetch("/api/orchestration/workflow-runs?limit=12"),
        fetch("/api/orchestration/agents"),
      ]);

      const [templatesData, runsData, agentsData] = await Promise.all([
        templatesRes.json(),
        runsRes.json(),
        agentsRes.json(),
      ]);

      setTemplates(templatesData.templates ?? []);
      setRuns(runsData.runs ?? []);
      setAgents(
        (agentsData.agents ?? []).map((agent: AgentOption) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        }))
      );
    } catch {
      toast.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (creatingNew) {
      return;
    }

    if (templates.length === 0) {
      return;
    }

    const template =
      templates.find((candidate) => candidate.id === selectedTemplateId) ?? templates[0];

    if (!template) {
      return;
    }

    setSelectedTemplateId(template.id);
    setName(template.name);
    setSlug(template.slug);
    setDescription(template.description ?? "");
    setStatus(template.status);
    setDefinitionText(JSON.stringify(template.definitionJson, null, 2));
  }, [creatingNew, selectedTemplateId, templates]);

  const activeRuns = useMemo(
    () =>
      runs.filter((run) =>
        ["queued", "running", "waiting_approval"].includes(run.status)
      ).length,
    [runs]
  );

  const waitingApprovals = useMemo(
    () => runs.filter((run) => run.status === "waiting_approval").length,
    [runs]
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

  const resetEditor = () => {
    setCreatingNew(true);
    setSelectedTemplateId(null);
    setName("");
    setSlug("");
    setDescription("");
    setStatus("active");
    setDefinitionText(SAMPLE_DEFINITION);
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const parsedDefinition = JSON.parse(definitionText);
      const targetUrl = selectedTemplateId
        ? `/api/orchestration/workflows/${selectedTemplateId}`
        : "/api/orchestration/workflows";
      const method = selectedTemplateId ? "PATCH" : "POST";

      const res = await fetch(targetUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
          status,
          definition: parsedDefinition,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save workflow template");
        return;
      }

      toast.success(selectedTemplateId ? "Workflow template updated" : "Workflow template created");
      await fetchData();
      if (data.template?.id) {
        setCreatingNew(false);
        setSelectedTemplateId(data.template.id);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Workflow definition must be valid JSON"
      );
    } finally {
      setSaving(false);
    }
  };

  const startRun = async () => {
    if (!selectedTemplateId) {
      toast.error("Save the workflow template before starting a run");
      return;
    }

    setStarting(true);
    try {
      const res = await fetch(`/api/orchestration/workflows/${selectedTemplateId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: workflowInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start workflow");
        return;
      }

      toast.success("Workflow run started");
      window.location.href = `/settings/agents/workflows/runs/${data.run.id}`;
    } catch {
      toast.error("Failed to start workflow");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-4 p-6">
          <Link
            href="/settings/agents"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            <ArrowLeft size={16} /> Agents
          </Link>
          <div className="flex-1" />
          <h1 className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--ink)" }}>
            <Workflow size={20} /> Workflow Builder
          </h1>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Templates" value={String(templates.length)} sub="Reusable orchestration graphs" />
        <StatCard label="Active runs" value={String(activeRuns)} sub="Queued, running, or waiting approval" />
        <StatCard label="Approval gates" value={String(waitingApprovals)} sub="Runs paused on human decision" />
        <StatCard label="Connected agents" value={String(agents.length)} sub="Available for workflow steps" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Templates</CardTitle>
            <Button size="sm" variant="outline" onClick={resetEditor}>
              <Plus size={14} className="mr-1" /> New
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                Loading templates…
              </p>
            ) : templates.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                No workflow templates yet. Create the first one from the editor.
              </p>
            ) : (
              <div className="grid gap-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      setCreatingNew(false);
                      setSelectedTemplateId(template.id);
                    }}
                    className="rounded border p-3 text-left transition-colors hover:bg-[var(--panel-soft)]"
                    style={{
                      borderColor:
                        selectedTemplateId === template.id ? "var(--brand-500)" : "var(--line)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: "var(--ink)" }}>
                        {template.name}
                      </span>
                      <Badge variant={STATUS_VARIANTS[template.status] ?? "neutral"} className="text-xs">
                        {template.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                      {template.definitionJson.nodes.length} nodes · v{template.version}
                    </p>
                    {template.description ? (
                      <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                        {template.description}
                      </p>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {selectedTemplate ? `Edit template: ${selectedTemplate.name}` : "Create workflow template"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_180px]">
                <input
                  className="rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                  placeholder="Workflow name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <input
                  className="rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                  placeholder="Slug (optional)"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
                <select
                  className="rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="active">active</option>
                  <option value="draft">draft</option>
                  <option value="archived">archived</option>
                </select>
              </div>

              <textarea
                className="min-h-[80px] rounded border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
                placeholder="What does this workflow achieve?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />

              <textarea
                className="min-h-[360px] rounded border px-3 py-2 font-mono text-xs"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
                value={definitionText}
                onChange={(event) => setDefinitionText(event.target.value)}
              />

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <textarea
                  className="min-h-[96px] rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                  placeholder="Runtime input: user request, concept, or execution brief"
                  value={workflowInput}
                  onChange={(event) => setWorkflowInput(event.target.value)}
                />
                <Button onClick={saveTemplate} disabled={saving || !name.trim()}>
                  <Save size={14} className="mr-1" />
                  {saving ? "Saving…" : selectedTemplateId ? "Save changes" : "Create template"}
                </Button>
                <Button
                  variant="outline"
                  onClick={startRun}
                  disabled={starting || !selectedTemplateId}
                >
                  <Play size={14} className="mr-1" />
                  {starting ? "Starting…" : "Run workflow"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Builder notes</CardTitle>
            </CardHeader>
              <CardContent className="grid gap-3 text-sm" style={{ color: "var(--ink-soft)" }}>
                <p>
                  Use <code>kind: &quot;agent&quot;</code> for real delegation into the heartbeat engine and <code>kind: &quot;approval&quot;</code>
                  to pause the workflow on a human gate.
                </p>
              <p>
                Supported placeholders: <code>{"{{input}}"}</code>, <code>{"{{prev}}"}</code>, or any node id like{" "}
                <code>{"{{implementation}}"}</code>.
              </p>
              <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
                <p className="mb-2 font-medium" style={{ color: "var(--ink)" }}>
                  Connected agents
                </p>
                <div className="flex flex-wrap gap-2">
                  {agents.map((agent) => (
                    <Badge key={agent.id} variant="neutral" className="text-xs">
                      {agent.name} · {agent.role}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch size={16} /> Recent workflow runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No workflow runs yet.
            </p>
          ) : (
            <div className="grid gap-3">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/settings/agents/workflows/runs/${run.id}`}
                  className="rounded border p-4 transition-colors hover:bg-[var(--panel-soft)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[run.status] ?? "neutral"} className="text-xs">
                      {run.status}
                    </Badge>
                    <span className="font-medium" style={{ color: "var(--ink)" }}>
                      {run.template.name}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {run.triggerType} · v{run.template.version}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                    <span>Queued: {run.summary.queued ?? 0}</span>
                    <span>Running: {run.summary.running ?? 0}</span>
                    <span>Waiting approval: {run.summary.waiting_approval ?? 0}</span>
                    <span>Succeeded: {run.summary.succeeded ?? 0}</span>
                    <span>Failed: {run.summary.failed ?? 0}</span>
                  </div>
                  {run.errorMessage ? (
                    <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
                      {run.errorMessage}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase" style={{ color: "var(--ink-muted)" }}>
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--ink)" }}>
          {value}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}
