"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Key,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ──────────────────────────────────────────────

type AgentRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  definitionId: string | null;
  adapterType: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  reportsToId: string | null;
  createdAt: string;
  runtimeState?: {
    totalTokens: number;
    totalCostCents: number;
    lastHeartbeatAt: string | null;
    lastError: string | null;
  } | null;
};

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

// ── Helpers ────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-400",
  running: "bg-green-500 animate-pulse",
  paused: "bg-yellow-500",
  error: "bg-red-500",
  pending_approval: "bg-blue-500",
  terminated: "bg-gray-700",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS[status] ?? "bg-gray-300"}`}
    />
  );
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Main Page ──────────────────────────────────────────

export default function AgentsSettingsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("analyst");
  const [newBudget, setNewBudget] = useState("");
  const [newReportsTo, setNewReportsTo] = useState("");

  // API Keys panel
  const [keysFor, setKeysFor] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = useState("default");

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orchestration/agents");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      toast.error("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // ── CRUD ──

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/orchestration/sync", { method: "POST" });
      const data = await res.json();
      toast.success(data.message ?? "Agents synced");
      fetchAgents();
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch("/api/orchestration/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          role: newRole,
          reportsToId: newReportsTo || undefined,
          budgetMonthlyCents: newBudget ? Number(newBudget) * 100 : 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error);
        return;
      }
      toast.success("Agent created");
      setShowCreate(false);
      setNewName("");
      setNewBudget("");
      fetchAgents();
    } catch {
      toast.error("Create failed");
    }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      await fetch(`/api/orchestration/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      toast.success(`Agent ${action}d`);
      fetchAgents();
    } catch {
      toast.error(`Failed to ${action} agent`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
    try {
      await fetch(`/api/orchestration/agents/${id}`, { method: "DELETE" });
      toast.success("Agent deleted");
      if (keysFor === id) setKeysFor(null);
      fetchAgents();
    } catch {
      toast.error("Delete failed");
    }
  };

  // ── API Keys ──

  const fetchKeys = async (agentId: string) => {
    setKeysFor(agentId);
    try {
      const res = await fetch(`/api/orchestration/agents/${agentId}/keys`);
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      toast.error("Failed to load keys");
    }
  };

  const handleCreateKey = async () => {
    if (!keysFor) return;
    try {
      const res = await fetch(`/api/orchestration/agents/${keysFor}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (data.key?.plainKey) {
        await navigator.clipboard.writeText(data.key.plainKey);
        toast.success("Key created & copied! Save it — shown once only.");
      }
      fetchKeys(keysFor);
    } catch {
      toast.error("Key creation failed");
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!keysFor) return;
    try {
      await fetch(`/api/orchestration/agents/${keysFor}/keys/${keyId}`, {
        method: "DELETE",
      });
      toast.success("Key revoked");
      fetchKeys(keysFor);
    } catch {
      toast.error("Revoke failed");
    }
  };

  // ── Render ──

  return (
    <div className="grid gap-4">
      {/* Header */}
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-4 p-6">
          <Link
            href="/settings"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            <ArrowLeft size={16} /> Settings
          </Link>
          <div className="flex-1" />
          <h1
            className="flex items-center gap-2 text-lg font-semibold"
            style={{ color: "var(--ink)" }}
          >
            <Bot size={20} /> Agent Orchestration
          </h1>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} className="mr-1" /> New Agent
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw
            size={14}
            className={`mr-1 ${syncing ? "animate-spin" : ""}`}
          />
          Sync Definitions
        </Button>
        <Link href="/settings/agents/org-chart">
          <Button variant="outline" size="sm">
            <Users size={14} className="mr-1" /> Org Chart
          </Button>
        </Link>
        <Link href="/settings/agents/dashboard">
          <Button variant="outline" size="sm">
            Dashboard
          </Button>
        </Link>
        <Link href="/settings/agents/heartbeat">
          <Button variant="outline" size="sm">
            Heartbeat Monitor
          </Button>
        </Link>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Agent</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
              }}
              placeholder="Agent name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <select
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
              }}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="ceo">CEO</option>
              <option value="pm">PM</option>
              <option value="analyst">Analyst</option>
              <option value="engineer">Engineer</option>
              <option value="finance">Finance</option>
              <option value="writer">Writer</option>
              <option value="reviewer">Reviewer</option>
            </select>
            <input
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
              }}
              placeholder="Monthly budget ($)"
              type="number"
              value={newBudget}
              onChange={(e) => setNewBudget(e.target.value)}
            />
            <select
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
              }}
              value={newReportsTo}
              onChange={(e) => setNewReportsTo(e.target.value)}
            >
              <option value="">No supervisor</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <Button size="sm" onClick={handleCreate}>
                Create
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agents list */}
      {loading ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            Loading agents…
          </CardContent>
        </Card>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            No agents yet. Click &quot;Sync Definitions&quot; to seed from code, or create a custom
            agent.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="overflow-hidden">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                {/* Left: status + name */}
                <StatusDot status={agent.status} />
                <div className="min-w-0 flex-1">
                  <div
                    className="flex items-center gap-2 text-sm font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {agent.name}
                    {agent.definitionId && (
                      <Badge variant="info" className="text-xs">
                        preset
                      </Badge>
                    )}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {agent.role} · {agent.slug} · {agent.adapterType}
                  </div>
                </div>

                {/* Budget */}
                {agent.budgetMonthlyCents > 0 && (
                  <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
                    {formatCents(agent.spentMonthlyCents)} /{" "}
                    {formatCents(agent.budgetMonthlyCents)}
                  </div>
                )}

                {/* Runtime state */}
                {agent.runtimeState?.lastHeartbeatAt && (
                  <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    Last run:{" "}
                    {new Date(
                      agent.runtimeState.lastHeartbeatAt
                    ).toLocaleDateString()}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {agent.status === "paused" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAction(agent.id, "resume")}
                      title="Resume"
                    >
                      <Play size={14} />
                    </Button>
                  ) : agent.status !== "terminated" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAction(agent.id, "pause")}
                      title="Pause"
                    >
                      <Pause size={14} />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchKeys(agent.id)}
                    title="API Keys"
                  >
                    <Key size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(agent.id, agent.name)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </CardContent>

              {/* Keys panel (expanded) */}
              {keysFor === agent.id && (
                <div
                  className="border-t px-4 py-3"
                  style={{ borderColor: "var(--line)", background: "var(--panel-soft)" }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Shield size={14} style={{ color: "var(--ink-soft)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      API Keys
                    </span>
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setKeysFor(null)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  {keys.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      No API keys yet
                    </p>
                  ) : (
                    <div className="mb-2 grid gap-1">
                      {keys.map((k) => (
                        <div
                          key={k.id}
                          className="flex items-center gap-2 text-xs"
                          style={{ color: "var(--ink-soft)" }}
                        >
                          <code>{k.keyPrefix}…</code>
                          <span>{k.name}</span>
                          <span className="flex-1" />
                          {k.lastUsedAt && (
                            <span>
                              used{" "}
                              {new Date(k.lastUsedAt).toLocaleDateString()}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevokeKey(k.id)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded border px-2 py-1 text-xs"
                      style={{
                        borderColor: "var(--line)",
                        background: "var(--surface)",
                        color: "var(--ink)",
                      }}
                      placeholder="Key name"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                    <Button size="sm" onClick={handleCreateKey}>
                      <Plus size={12} className="mr-1" /> Generate
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
