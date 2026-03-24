"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Edit2, Plus, ShieldCheck, ShieldX, Trash2 } from "lucide-react";

import { RiskFormModal } from "@/components/risks/risk-form-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/contexts/locale-context";
import { useProjects, useRisks } from "@/lib/hooks/use-api";
import { Project, Risk } from "@/lib/types";
import { buildRiskApiPayload, type RiskFormValues } from "@/lib/risks/risk-form";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function RisksSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} className="p-2">
            <Skeleton className="h-4 w-16 mb-1" />
            <Skeleton className="h-6 w-10" />
          </Card>
        ))}
      </div>
      <Card className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </Card>
    </div>
  );
}

// Risk Matrix cell color
function getRiskLevel(probability: number, impact: number): "low" | "medium" | "high" | "critical" {
  const score = probability * impact;
  if (score >= 20) return "critical";
  if (score >= 12) return "high";
  if (score >= 6) return "medium";
  return "low";
}

const riskLevelColors = {
  low: "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700",
  medium: "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700",
  high: "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700",
  critical: "bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700",
};

export function RisksPage() {
  const { enumLabel, t } = useLocale();
  const { projects } = useProjects();
  const { error, isLoading, mutate, risks } = useRisks();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<Pick<Risk, "id" | "title" | "description" | "probability" | "impact" | "status" | "projectId"> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const projectOptions: Pick<Project, "id" | "name">[] = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects]
  );
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const canCreateRisk = projectOptions.length > 0;

  const handleCreateRisk = async (data: RiskFormValues) => {
    try {
      const response = await fetch("/api/risks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRiskApiPayload(data)),
      });
      if (!response.ok) throw new Error("Failed to create risk");
      await mutate();
      toast.success(t("risks.created"));
    } catch (error) {
      toast.error(t("error.saveDescription"));
      throw error;
    }
  };

  const handleUpdateRisk = async (data: RiskFormValues) => {
    if (!editingRisk) return;
    try {
      const response = await fetch(`/api/risks/${editingRisk.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRiskApiPayload(data)),
      });
      if (!response.ok) throw new Error("Failed to update risk");
      await mutate();
      toast.success(t("risks.updated"));
    } catch (error) {
      toast.error(t("error.saveDescription"));
      throw error;
    }
  };

  const handleDeleteRisk = async (riskId: string) => {
    if (!confirm(t("risks.confirmDelete"))) return;
    setDeleting(riskId);
    try {
      const response = await fetch(`/api/risks/${riskId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete risk");
      await mutate();
      toast.success(t("risks.deleted"));
    } catch {
      toast.error(t("error.deleteDescription"));
    } finally {
      setDeleting(null);
    }
  };

  const openEditModal = (risk: typeof risks[0]) => {
    setEditingRisk({
      id: risk.id,
      title: risk.title,
      description: risk.description,
      probability: risk.probability,
      impact: risk.impact,
      status: risk.status,
      projectId: risk.projectId,
    });
    setModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingRisk(null);
    setModalOpen(true);
  };

  if (isLoading && risks.length === 0) {
    return <RisksSkeleton />;
  }

  if (error && risks.length === 0) {
    return (
      <DataErrorState
        actionLabel={t("action.retry")}
        description={error instanceof Error ? error.message : t("error.loadDescription")}
        onRetry={() => {
          void mutate();
        }}
        title={t("error.loadTitle")}
      />
    );
  }

  const openCount = risks.filter((risk) => risk.status === "open").length;
  const criticalCount = risks.filter((risk) => risk.probability >= 5 || risk.impact >= 5).length;
  const mitigatedCount = risks.filter((risk) => risk.status === "mitigated").length;

  // Build risk matrix (5x5)
  const matrixRisks: Record<string, typeof risks> = {};
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      matrixRisks[`${p}-${i}`] = risks.filter(r => r.probability === p && r.impact === i);
    }
  }

  return (
    <div className="grid gap-3">
      {/* Compact Stats Row */}
      <div className="grid gap-2 grid-cols-3">
        <Card className="p-2 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-[10px] uppercase text-amber-600">{t("risks.open")}</p>
          </div>
          <p className="text-lg font-bold text-amber-600">{openCount}</p>
        </Card>
        <Card className="p-2 border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-600" />
            <p className="text-[10px] uppercase text-red-600">{t("risks.critical")}</p>
          </div>
          <p className="text-lg font-bold text-red-600">{criticalCount}</p>
        </Card>
        <Card className="p-2 border-green-500/20 bg-green-500/5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <p className="text-[10px] uppercase text-green-600">{t("risks.mitigated")}</p>
          </div>
          <p className="text-lg font-bold text-green-600">{mitigatedCount}</p>
        </Card>
      </div>

      {/* Main Content: Matrix + List */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Risk Matrix */}
        <Card className="p-3">
          <h3 className="mb-2 text-sm font-medium">Матрица рисков</h3>
          <div className="relative">
            {/* Y-axis label */}
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[10px] text-muted-foreground">
              Вероятность →
            </div>
            
            <div className="ml-6">
              {/* Matrix grid */}
              <div className="grid gap-0.5" style={{ gridTemplateColumns: 'auto repeat(5, 1fr)' }}>
                {/* Header row */}
                <div></div>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="py-0.5 text-center text-[10px] text-muted-foreground">
                    {i}
                  </div>
                ))}
                
                {/* Matrix rows (5 to 1 for proper display) */}
                {[5, 4, 3, 2, 1].map(p => (
                  <Fragment key={p}>
                    <div className="flex items-center pr-1 text-[10px] text-muted-foreground">
                      {p}
                    </div>
                    {[1, 2, 3, 4, 5].map(i => {
                      const level = getRiskLevel(p, i);
                      const cellRisks = matrixRisks[`${p}-${i}`] || [];
                      return (
                        <div
                          key={`${p}-${i}`}
                          className={cn(
                            "aspect-square border rounded flex items-center justify-center text-[10px] font-medium",
                            riskLevelColors[level],
                            cellRisks.length > 0 ? "font-bold" : ""
                          )}
                          title={cellRisks.length > 0 ? cellRisks.map(r => r.title).join(", ") : undefined}
                        >
                          {cellRisks.length > 0 ? cellRisks.length : ""}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              
              {/* X-axis label */}
              <div className="mt-1 text-center text-[10px] text-muted-foreground">
                Влияние →
              </div>
            </div>
          </div>
          
          {/* Legend */}
          <div className="mt-2 flex gap-2 text-[10px]">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30 border border-green-300"></div>
              <span>Низкий</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300"></div>
              <span>Средний</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-orange-100 dark:bg-orange-900/30 border border-orange-300"></div>
              <span>Высокий</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30 border border-red-300"></div>
              <span>Критичный</span>
            </div>
          </div>
        </Card>

        {/* Risk List */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">{t("risks.title")} ({risks.length})</h3>
            <Button
              className="h-7 text-xs"
              disabled={!canCreateRisk}
              onClick={openCreateModal}
              size="sm"
            >
              <Plus className="h-3 w-3 mr-1" />
              {t("risks.create")}
            </Button>
          </div>
          
          <div className="space-y-1.5 max-h-[56vh] overflow-y-auto pr-1">
            {risks.map((risk) => {
              const level = getRiskLevel(risk.probability, risk.impact);
              return (
                <div
                  key={risk.id}
                  className="flex items-center gap-2 rounded border bg-[var(--panel-soft)]/40 p-1.5 hover:bg-[var(--panel-soft)]/60"
                >
                  <div className={cn(
                    "flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold",
                    level === "critical" && "bg-red-500/20 text-red-600",
                    level === "high" && "bg-orange-500/20 text-orange-600",
                    level === "medium" && "bg-yellow-500/20 text-yellow-600",
                    level === "low" && "bg-green-500/20 text-green-600"
                  )}>
                    {risk.probability * risk.impact}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-medium">{risk.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      P{risk.probability} × I{risk.impact} • {risk.owner} •{" "}
                      {projectNameById.get(risk.projectId) ?? t("project.none")}
                    </p>
                  </div>
                  <Badge 
                    variant={risk.status === "open" ? "danger" : risk.status === "mitigated" ? "warning" : "success"}
                    className="px-1.5 py-0.5 text-[10px]"
                  >
                    {enumLabel("riskStatus", risk.status)}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => openEditModal(risk)}
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      disabled={deleting === risk.id}
                      onClick={() => handleDeleteRisk(risk.id)}
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <RiskFormModal
        projects={projectOptions}
        onSubmit={editingRisk ? handleUpdateRisk : handleCreateRisk}
        open={modalOpen}
        onOpenChange={setModalOpen}
        risk={editingRisk}
      />
    </div>
  );
}
