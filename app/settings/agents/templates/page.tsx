"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bot, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Preset = {
  id: string;
  name: string;
  nameRu: string;
  role: string;
  description: string;
  descriptionRu: string;
  suggestedSchedule: string | null;
  suggestedBudgetCents: number;
};

export default function TemplatesPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestration/templates");
      const data = await res.json();
      setPresets(data.presets ?? []);
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const handleCreate = async (presetId: string) => {
    setCreating(presetId);
    try {
      const res = await fetch("/api/orchestration/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId,
          workspaceId: "default",
        }),
      });
      if (res.ok) {
        toast.success("Agent created from template!");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Create failed");
      }
    } catch {
      toast.error("Create failed");
    } finally {
      setCreating(null);
    }
  };

  const ROLE_BADGE: Record<string, "info" | "success" | "warning" | "neutral"> = {
    pm: "info",
    analyst: "success",
    finance: "warning",
    communicator: "neutral",
    specialist: "info",
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
          <h1
            className="flex items-center gap-2 text-lg font-semibold"
            style={{ color: "var(--ink)" }}
          >
            <Sparkles size={20} /> Agent Templates
          </h1>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--ink-muted)" }}>
            Loading templates…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot size={16} />
                  {p.nameRu}
                  <Badge variant={ROLE_BADGE[p.role] ?? "neutral"} className="text-xs">
                    {p.role}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                  {p.descriptionRu}
                </p>
                <div className="flex gap-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {p.suggestedSchedule && <span>⏰ {p.suggestedSchedule}</span>}
                  <span>💰 ${(p.suggestedBudgetCents / 100).toFixed(0)}/мес</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleCreate(p.id)}
                  disabled={creating === p.id}
                >
                  <Plus size={14} className="mr-1" />
                  {creating === p.id ? "Создаю…" : "Создать из шаблона"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
