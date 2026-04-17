import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles, Input, Textarea } from "@/components/ui/field";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";

import type { FeedbackFormState } from "@/components/pilot-feedback/pilot-feedback-utils";

export function PilotFeedbackForm({
  error,
  formState,
  isCreating,
  liveFeedbackReady,
  members,
  onChange,
  onSubmit,
}: {
  error: string | null;
  formState: FeedbackFormState;
  isCreating: boolean;
  liveFeedbackReady: boolean;
  members: WorkReportMemberOption[];
  onChange: (updates: Partial<FeedbackFormState>) => void;
  onSubmit: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Create feedback item</CardTitle>
        <CardDescription>
          Record one durable pilot feedback item against a real workflow artifact, then
          track it to closure.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          <div>
            Target prefill:{" "}
            <span className="font-medium text-[var(--ink)]">
              {formState.targetLabel || "Manual entry"}
            </span>
          </div>
          <div>
            Source link:{" "}
            <span className="font-medium text-[var(--ink)]">
              {formState.sourceHref || "Not provided"}
            </span>
          </div>
        </div>

        {error ? (
          <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Тип цели</span>
          <select
            className={fieldStyles}
            disabled={!liveFeedbackReady || isCreating}
            onChange={(event) =>
              onChange({
                targetType: event.target.value as FeedbackFormState["targetType"],
              })
            }
            value={formState.targetType}
          >
            <option value="exception_item">Exception item</option>
            <option value="workflow_run">Workflow run</option>
            <option value="reconciliation_casefile">Reconciliation casefile</option>
          </select>
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>ID цели</span>
          <Input
            disabled={!liveFeedbackReady || isCreating}
            onChange={(event) => onChange({ targetId: event.target.value })}
            placeholder="run-123 или exception:esc-1"
            value={formState.targetId}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Название цели</span>
          <Input
            disabled={!liveFeedbackReady || isCreating}
            onChange={(event) => onChange({ targetLabel: event.target.value })}
            placeholder="Понятное название workflow"
            value={formState.targetLabel}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Краткое описание проблемы</span>
          <Input
            disabled={!liveFeedbackReady || isCreating}
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder="Что не так или требует доработки?"
            value={formState.summary}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
          <span>Детали</span>
          <Textarea
            disabled={!liveFeedbackReady || isCreating}
            onChange={(event) => onChange({ details: event.target.value })}
            placeholder="Опциональная заметка пилота, контекст воспроизведения или ожидания стейкхолдеров."
            value={formState.details}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Severity</span>
            <select
              className={fieldStyles}
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) =>
                onChange({
                  severity: event.target.value as FeedbackFormState["severity"],
                })
              }
              value={formState.severity}
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Owner</span>
            <select
              className={fieldStyles}
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) => onChange({ ownerId: event.target.value })}
              value={formState.ownerId}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} {member.role ? `· ${member.role}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>ID проекта</span>
            <Input
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) => onChange({ projectId: event.target.value })}
              placeholder="Опциональный ID проекта"
              value={formState.projectId}
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Название проекта</span>
            <Input
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) => onChange({ projectName: event.target.value })}
              placeholder="Опциональное название проекта"
              value={formState.projectName}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Название источника</span>
            <Input
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) => onChange({ sourceLabel: event.target.value })}
              placeholder="Исключение из командного центра"
              value={formState.sourceLabel}
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Source href</span>
            <Input
              disabled={!liveFeedbackReady || isCreating}
              onChange={(event) => onChange({ sourceHref: event.target.value })}
              placeholder="/command-center"
              value={formState.sourceHref}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={
              !liveFeedbackReady ||
              isCreating ||
              !formState.targetId.trim() ||
              !formState.targetLabel.trim() ||
              !formState.summary.trim()
            }
            onClick={onSubmit}
          >
            {isCreating ? "Creating..." : "Create feedback"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
