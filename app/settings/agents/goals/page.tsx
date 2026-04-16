"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──

type GoalNode = {
  id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
  progress: number;
  ownerAgentId: string | null;
  subGoals: GoalNode[];
};

const LEVEL_COLORS: Record<string, "info" | "success" | "warning" | "neutral"> = {
  company: "info",
  team: "success",
  agent: "warning",
  task: "neutral",
};

// ── Tree Node ──

function GoalTreeNode({
  node,
  depth = 0,
  onDelete,
}: {
  node: GoalNode;
  depth?: number;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className={depth > 0 ? "ml-4 border-l pl-3" : ""} style={{ borderColor: "var(--line)" }}>
      <div
        className="mb-1.5 flex items-center gap-2 rounded border px-3 py-2"
        style={{ borderColor: "var(--line)", background: "var(--surface-panel)" }}
      >
        {node.subGoals.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="shrink-0">
            <ChevronRight
              size={14}
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              style={{ color: "var(--ink-soft)" }}
            />
          </button>
        )}
        <Target size={14} style={{ color: "var(--ink-soft)" }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--ink)" }}>
            {node.title}
            <Badge variant={LEVEL_COLORS[node.level] ?? "neutral"} className="text-xs">
              {node.level}
            </Badge>
            <Badge
              variant={
                node.status === "done"
                  ? "success"
                  : node.status === "in_progress"
                    ? "info"
                    : "neutral"
              }
              className="text-xs"
            >
              {node.status}
            </Badge>
          </div>
          {node.description && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
              {node.description}
            </p>
          )}
        </div>
        {node.progress > 0 && (
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {node.progress}%
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={() => onDelete(node.id)}>
          <Trash2 size={12} />
        </Button>
      </div>
      {expanded &&
        node.subGoals.map((child) => (
          <GoalTreeNode key={child.id} node={child} depth={depth + 1} onDelete={onDelete} />
        ))}
    </div>
  );
}

// ── Page ──

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLevel, setNewLevel] = useState("team");
  const [newDesc, setNewDesc] = useState("");

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestration/goals");
      const data = await res.json();
      setGoals(data.goals ?? []);
    } catch {
      toast.error("Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      await fetch("/api/orchestration/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          level: newLevel,
          description: newDesc || undefined,
        }),
      });
      toast.success("Goal created");
      setShowCreate(false);
      setNewTitle("");
      setNewDesc("");
      fetchGoals();
    } catch {
      toast.error("Create failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this goal?")) return;
    try {
      await fetch(`/api/orchestration/goals/${id}`, { method: "DELETE" });
      toast.success("Goal deleted");
      fetchGoals();
    } catch {
      toast.error("Delete failed");
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
            <Target size={20} /> Goals
          </h1>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1" /> New Goal
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Goal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <input
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
              placeholder="Goal title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <select
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
              value={newLevel}
              onChange={(e) => setNewLevel(e.target.value)}
            >
              <option value="company">Company</option>
              <option value="team">Team</option>
              <option value="agent">Agent</option>
              <option value="task">Task</option>
            </select>
            <input
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <div className="flex gap-2 sm:col-span-3">
              <Button size="sm" onClick={handleCreate}>Create</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            Loading goals…
          </CardContent>
        </Card>
      ) : goals.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            No goals yet. Create one to organize agent work into measurable objectives.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            {goals.map((g) => (
              <GoalTreeNode key={g.id} node={g} onDelete={handleDelete} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
