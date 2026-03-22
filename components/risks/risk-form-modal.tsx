"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldStyles, Input, Textarea } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { Project, Risk, RiskStatus } from "@/lib/types";
import type { RiskFormValues } from "@/lib/risks/risk-form";

interface RiskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Pick<Project, "id" | "name">[];
  risk?: Pick<Risk, "id" | "title" | "description" | "probability" | "impact" | "status" | "projectId"> | null;
  onSubmit: (data: RiskFormValues) => Promise<void>;
}

export function RiskFormModal({ open, onOpenChange, projects, risk, onSubmit }: RiskFormModalProps) {
  const { t } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState(risk?.title ?? "");
  const [description, setDescription] = useState(risk?.description ?? "");
  const [probability, setProbability] = useState(risk?.probability ?? 3);
  const [impact, setImpact] = useState(risk?.impact ?? 3);
  const [status, setStatus] = useState<RiskStatus>(risk?.status ?? "open");
  const [projectId, setProjectId] = useState(risk?.projectId ?? projects[0]?.id ?? "");

  useEffect(() => {
    if (!open) return;

    setTitle(risk?.title ?? "");
    setDescription(risk?.description ?? "");
    setProbability(risk?.probability ?? 3);
    setImpact(risk?.impact ?? 3);
    setStatus(risk?.status ?? "open");
    setProjectId(risk?.projectId ?? projects[0]?.id ?? "");
  }, [open, projects, risk]);

  const handleSubmit = async () => {
    if (!title.trim() || !projectId) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        projectId,
        probability,
        impact,
        status,
      });
      onOpenChange(false);
      // Reset form
      setTitle("");
      setDescription("");
      setProbability(3);
      setImpact(3);
      setStatus("open");
      setProjectId(projects[0]?.id ?? "");
    } catch (error) {
      console.error("[RiskFormModal] Error submitting:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form on close
      setTitle(risk?.title ?? "");
      setDescription(risk?.description ?? "");
      setProbability(risk?.probability ?? 3);
      setImpact(risk?.impact ?? 3);
      setStatus(risk?.status ?? "open");
      setProjectId(risk?.projectId ?? projects[0]?.id ?? "");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {risk ? t("risks.edit") : t("risks.create")}
          </DialogTitle>
          <DialogDescription>
            {risk ? t("risks.editDescription") : t("risks.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="risk-project">
              {t("field.project")} *
            </label>
            <select
              className={fieldStyles}
              disabled={projects.length === 0}
              id="risk-project"
              onChange={(e) => setProjectId(e.target.value)}
              value={projectId}
            >
              {projects.length === 0 ? (
                <option value="">{t("project.none")}</option>
              ) : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {projects.length === 0 ? (
              <p className="text-xs text-[var(--ink-muted)]">{t("project.none")}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="risk-title">
              {t("risks.title")} *
            </label>
            <Input
              className={fieldStyles}
              id="risk-title"
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("risks.titlePlaceholder")}
              value={title}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="risk-description">
              {t("risks.description")}
            </label>
            <Textarea
              className={fieldStyles}
              id="risk-description"
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("risks.descriptionPlaceholder")}
              rows={3}
              value={description}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                {t("risks.probability")}: {probability}/5
              </label>
              <input
                className="w-full"
                max={5}
                min={1}
                onChange={(e) => setProbability(Number(e.target.value))}
                type="range"
                value={probability}
              />
              <div className="flex justify-between text-xs text-[var(--ink-muted)]">
                <span>{t("risks.low")}</span>
                <span>{t("risks.high")}</span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">
                {t("risks.impact")}: {impact}/5
              </label>
              <input
                className="w-full"
                max={5}
                min={1}
                onChange={(e) => setImpact(Number(e.target.value))}
                type="range"
                value={impact}
              />
              <div className="flex justify-between text-xs text-[var(--ink-muted)]">
                <span>{t("risks.low")}</span>
                <span>{t("risks.high")}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="risk-status">
              {t("risks.status")}
            </label>
            <select
              className={fieldStyles}
              id="risk-status"
              onChange={(e) => setStatus(e.target.value as RiskStatus)}
              value={status}
            >
              <option value="open">{t("risks.open")}</option>
              <option value="mitigating">{t("risks.mitigating")}</option>
              <option value="mitigated">{t("risks.mitigated")}</option>
              <option value="closed">{t("risks.closed")}</option>
            </select>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-3">
            <p className="text-xs font-medium text-[var(--ink-muted)]">{t("risks.riskLevel")}</p>
            <div className="mt-2">
              <Badge
                variant={
                  probability >= 5 || impact >= 5
                    ? "danger"
                    : probability >= 4 || impact >= 4
                      ? "warning"
                      : "info"
                }
              >
                {probability >= 5 || impact >= 5
                  ? t("risks.critical")
                  : probability >= 4 || impact >= 4
                    ? t("risks.high")
                    : t("risks.moderate")}
              </Badge>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} variant="secondary">
            {t("action.cancel")}
          </Button>
          <Button disabled={!title.trim() || !projectId || isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? t("action.saving") : risk ? t("action.save") : t("action.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
