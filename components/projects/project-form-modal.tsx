"use client";

import { useEffect, useId, useState } from "react";

import { useDashboard } from "@/components/dashboard-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import { useLocale } from "@/contexts/locale-context";
import { getRelativeIsoDate, getTodayIsoDate } from "@/lib/date";
import { Project, ProjectFormValues } from "@/lib/types";

function createEmptyProjectForm(): ProjectFormValues {
  return {
    name: "",
    description: "",
    direction: "construction",
    plannedBudget: 2500000,
    actualBudget: 0,
    currency: "RUB",
    start: getTodayIsoDate(),
    end: getRelativeIsoDate(180),
    team: [],
    location: "",
    priority: "medium",
    status: "planning",
    progress: 0,
  };
}

function toFormValues(project?: Project | null): ProjectFormValues {
  if (!project) return createEmptyProjectForm();
  return {
    name: project.name,
    description: project.description,
    direction: project.direction,
    plannedBudget: project.budget.planned,
    actualBudget: project.budget.actual,
    currency: project.budget.currency,
    start: project.dates.start,
    end: project.dates.end,
    team: project.team,
    location: project.location,
    priority: project.priority,
    status: project.status,
    progress: project.progress,
  };
}

interface ProjectFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
}

export function ProjectFormModal({
  open,
  onOpenChange,
  project,
}: ProjectFormModalProps) {
  const { addProject, team, updateProject } = useDashboard();
  const { enumLabel, t } = useLocale();
  const [values, setValues] = useState<ProjectFormValues>(toFormValues(project));
  const formId = useId();

  useEffect(() => {
    if (open) {
      setValues(toFormValues(project));
    }
  }, [open, project]);

  const availableMembers = team.map((member) => member.name);

  const setField = <Key extends keyof ProjectFormValues>(
    key: Key,
    value: ProjectFormValues[Key]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleMemberToggle = (memberName: string) => {
    setValues((current) => ({
      ...current,
      team: current.team.includes(memberName)
        ? current.team.filter((name) => name !== memberName)
        : [...current.team, memberName],
    }));
  };

  const handleSubmit = () => {
    if (!values.name.trim()) return;

    if (project) {
      updateProject(project.id, values);
    } else {
      addProject(values);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
        data-testid="create-project-form"
      >
        <DialogHeader>
          <DialogTitle>{project ? t("form.project.editTitle") : t("form.project.createTitle")}</DialogTitle>
          <DialogDescription>{t("form.project.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-name`}>
                {t("field.name")}
              </label>
              <Input
                id={`${formId}-project-name`}
                data-testid="project-name-input"
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                placeholder={t("placeholder.projectName")}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-description`}>
                {t("field.description")}
              </label>
              <Textarea
                id={`${formId}-project-description`}
                value={values.description}
                onChange={(event) => setField("description", event.target.value)}
                placeholder={t("placeholder.projectDescription")}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-direction`}>
                  {t("field.direction")}
                </label>
                <select
                  id={`${formId}-project-direction`}
                  className={fieldStyles}
                  data-testid="project-direction-select"
                  value={values.direction}
                  onChange={(event) =>
                    setField("direction", event.target.value as ProjectFormValues["direction"])
                  }
                >
                  {(["metallurgy", "logistics", "trade", "construction"] as const).map((value) => (
                    <option key={value} value={value}>
                      {enumLabel("direction", value)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-status`}>
                  {t("field.status")}
                </label>
                <select
                  id={`${formId}-project-status`}
                  className={fieldStyles}
                  data-testid="project-status-select"
                  value={values.status}
                  onChange={(event) =>
                    setField("status", event.target.value as ProjectFormValues["status"])
                  }
                >
                  {(["active", "planning", "on-hold", "completed", "at-risk"] as const).map((value) => (
                    <option key={value} value={value}>
                      {enumLabel("projectStatus", value)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-budget-planned`}>
                  {t("field.budgetPlanned")}
                </label>
                <Input
                  id={`${formId}-project-budget-planned`}
                  type="number"
                  value={values.plannedBudget}
                  onChange={(event) => setField("plannedBudget", Number(event.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-budget-actual`}>
                  {t("field.budgetActual")}
                </label>
                <Input
                  id={`${formId}-project-budget-actual`}
                  type="number"
                  value={values.actualBudget}
                  onChange={(event) => setField("actualBudget", Number(event.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-start`}>
                  {t("field.startDate")}
                </label>
                <Input
                  id={`${formId}-project-start`}
                  data-testid="project-start-date-input"
                  type="date"
                  value={values.start}
                  onChange={(event) => setField("start", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-end`}>
                  {t("field.endDate")}
                </label>
                <Input
                  id={`${formId}-project-end`}
                  data-testid="project-end-date-input"
                  type="date"
                  value={values.end}
                  onChange={(event) => setField("end", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/65 p-5">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-location`}>
                {t("field.location")}
              </label>
              <Input
                id={`${formId}-project-location`}
                data-testid="project-location-input"
                value={values.location}
                onChange={(event) => setField("location", event.target.value)}
                placeholder={t("placeholder.location")}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-priority`}>
                {t("field.priority")}
              </label>
              <select
                id={`${formId}-project-priority`}
                className={fieldStyles}
                value={values.priority}
                onChange={(event) =>
                  setField("priority", event.target.value as ProjectFormValues["priority"])
                }
              >
                <option value="low">{enumLabel("priority", "low")}</option>
                <option value="medium">{enumLabel("priority", "medium")}</option>
                <option value="high">{enumLabel("priority", "high")}</option>
                <option value="critical">{enumLabel("priority", "critical")}</option>
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-[var(--ink)]" htmlFor={`${formId}-project-progress`}>
                {t("field.progress")}
              </label>
              <Input
                id={`${formId}-project-progress`}
                type="number"
                min={0}
                max={100}
                value={values.progress}
                onChange={(event) => setField("progress", Number(event.target.value))}
              />
            </div>

            <div className="grid gap-3">
              <span className="text-sm font-medium text-[var(--ink)]">{t("field.team")}</span>
              <div className="grid gap-2">
                {availableMembers.map((memberName) => {
                  const checked = values.team.includes(memberName);
                  const memberId = `${formId}-project-team-${memberName.replace(/\s+/g, "-").toLowerCase()}`;
                  return (
                    <label
                      key={memberName}
                      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition ${
                        checked
                          ? "border-[var(--brand)] bg-[color:color-mix(in_srgb,var(--brand)_16%,var(--surface-panel)_84%)] text-[var(--ink)] shadow-[0_10px_24px_rgba(15,23,42,.12)]"
                          : "border-[var(--line-strong)] bg-[var(--surface-panel)] text-[var(--ink-soft)] hover:bg-[var(--panel-soft)]"
                      }`}
                      htmlFor={memberId}
                    >
                      <input
                        id={memberId}
                        checked={checked}
                        className="h-4 w-4 rounded border-[var(--line-strong)] bg-[var(--panel-soft)] text-[var(--brand)] focus:ring-[var(--brand)]"
                        onChange={() => handleMemberToggle(memberName)}
                        type="checkbox"
                      />
                      <span className={checked ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)]"}>
                        {memberName}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button className="w-full sm:w-auto" data-testid="submit-project-button" onClick={handleSubmit}>
            {project ? t("action.save") : t("action.addProject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
