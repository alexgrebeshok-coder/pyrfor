"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bot, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// ── Types ──

type OrgNode = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  definitionId: string | null;
  children: OrgNode[];
};

const STATUS_COLORS: Record<string, string> = {
  idle: "border-gray-400",
  running: "border-green-500",
  paused: "border-yellow-500",
  error: "border-red-500",
  pending_approval: "border-blue-500",
  terminated: "border-gray-700",
};

// ── Tree Node ──

function OrgTreeNode({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  return (
    <div className={depth > 0 ? "ml-6 border-l pl-4" : ""} style={{ borderColor: "var(--line)" }}>
      <div
        className={`mb-2 flex items-center gap-2 rounded-lg border-l-4 px-3 py-2 ${
          STATUS_COLORS[node.status] ?? "border-gray-300"
        }`}
        style={{ background: "var(--surface-panel)" }}
      >
        <Bot size={16} style={{ color: "var(--ink-soft)" }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--ink)" }}>
            {node.name}
            {node.definitionId && (
              <Badge variant="info" className="text-xs">preset</Badge>
            )}
          </div>
          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {node.role} · {node.status}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <OrgTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Page ──

export default function OrgChartPage() {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orchestration/org-chart");
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch {
      toast.error("Failed to load org chart");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

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
          <h1
            className="flex items-center gap-2 text-lg font-semibold"
            style={{ color: "var(--ink)" }}
          >
            <Users size={20} /> Org Chart
          </h1>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            Loading org chart…
          </CardContent>
        </Card>
      ) : tree.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            No agents with hierarchy. Assign &quot;Reports to&quot; in agent settings to build the chart.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            {tree.map((root) => (
              <OrgTreeNode key={root.id} node={root} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
