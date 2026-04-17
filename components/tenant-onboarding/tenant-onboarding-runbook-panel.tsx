"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, fieldStyles } from "@/components/ui/field";
import type {
  TenantOnboardingOverview,
  TenantOnboardingRunbookRecord,
  TenantOnboardingRunbookStatus,
} from "@/lib/tenant-onboarding";

import {
  createEditorStateFromRunbook,
  createEmptyEditorState,
  type RunbookEditorState,
  statusVariant,
} from "./tenant-onboarding-runbook-panel-helpers";
import { TenantOnboardingRunbookRecords } from "./tenant-onboarding-runbook-panel-records";

export function TenantOnboardingRunbookPanel({
  availabilityNote,
  initialOverview,
}: {
  availabilityNote?: string;
  initialOverview: TenantOnboardingOverview;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<RunbookEditorState>(createEmptyEditorState());
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function loadOverview(focusId?: string | null) {
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/tenant-onboarding", {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load tenant onboarding.");
      }

      const nextOverview = payload as TenantOnboardingOverview;
      setOverview(nextOverview);
      setError(null);

      const nextFocusId = focusId ?? editingId;
      if (nextFocusId) {
        const matched = nextOverview.runbooks.find((entry) => entry.id === nextFocusId);
        if (matched) {
          setEditingId(matched.id);
          setEditor(createEditorStateFromRunbook(matched));
          return;
        }
      }

      setEditingId(null);
      setEditor(createEmptyEditorState());
    } catch (loadingError) {
      setError(
        loadingError instanceof Error
          ? loadingError.message
          : "Failed to load tenant onboarding."
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function saveRunbook() {
    setIsSaving(true);

    try {
      const requestBody = {
        handoffNotes: editor.handoffNotes.trim() || null,
        operatorNotes: editor.operatorNotes.trim() || null,
        rollbackPlan: editor.rollbackPlan.trim() || null,
        rolloutScope: editor.rolloutScope.trim(),
        status: editor.status,
        summary: editor.summary.trim(),
        targetCutoverAt: editor.targetCutoverAt
          ? new Date(editor.targetCutoverAt).toISOString()
          : null,
        targetTenantLabel: editor.targetTenantLabel.trim() || null,
        targetTenantSlug: editor.targetTenantSlug.trim() || null,
      };
      const response = await fetch(
        editingId ? `/api/tenant-onboarding/${editingId}` : "/api/tenant-onboarding",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to save tenant onboarding runbook.");
      }

      const saved = payload as TenantOnboardingRunbookRecord;
      setEditingId(saved.id);
      setEditor(createEditorStateFromRunbook(saved));
      setError(null);
      await loadOverview(saved.id);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save tenant onboarding runbook."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function loadEntry(entry: TenantOnboardingRunbookRecord) {
    setEditingId(entry.id);
    setEditor(createEditorStateFromRunbook(entry));
    setError(null);
  }

  function startNewDraft() {
    setEditingId(null);
    setEditor(createEmptyEditorState());
    setError(null);
  }

  const canSave =
    !availabilityNote &&
    !isSaving &&
    editor.summary.trim().length > 0 &&
    editor.rolloutScope.trim().length > 0;

  return (
    <div className="grid gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--surface-panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--ink)]">Tenant rollout runbook</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            Persist the target tenant, rollout scope, handoff notes, and rollback posture on top
            of the current readiness and governance baseline.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">{overview.template.version}</Badge>
          <Badge variant="info">{overview.currentReadiness.tenant.slug}</Badge>
        </div>
      </div>

      {availabilityNote ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          {availabilityNote}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[14px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 md:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Baseline readiness
          </div>
          <div className="mt-1 font-medium text-[var(--ink)]">
            {overview.currentReadiness.outcomeLabel}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Current review
          </div>
          <div className="mt-1 font-medium text-[var(--ink)]">
            {overview.currentReview.outcomeLabel}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Latest decision
          </div>
          <div className="mt-1 font-medium text-[var(--ink)]">
            {overview.latestDecision?.decisionLabel ?? "No decision yet"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Saved runbooks
          </div>
          <div className="mt-1 font-medium text-[var(--ink)]">{overview.summary.total}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => loadOverview()}
          type="button"
          variant="outline"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
        <Button onClick={startNewDraft} type="button" variant="outline">
          Start new draft
        </Button>
        {overview.latestRunbook ? (
          <Button
            onClick={() => {
              if (overview.latestRunbook) {
                loadEntry(overview.latestRunbook);
              }
            }}
            type="button"
            variant="outline"
          >
            Edit latest runbook
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="grid gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">
                {editingId ? "Edit runbook" : "New runbook"}
              </div>
              <div className="mt-1 text-xs text-[var(--ink-soft)]">
                {editingId
                  ? "Updating a runbook refreshes the readiness, review, and decision snapshot."
                  : "Creating a runbook captures the current baseline and adds target-tenant notes."}
              </div>
            </div>
            <Badge variant={statusVariant(editor.status)}>
              {editingId ? editor.status : "draft"}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Slug целевого тенанта</span>
              <Input
                onChange={(event) =>
                  setEditor((current) => ({ ...current, targetTenantSlug: event.target.value }))
                }
                placeholder="tenant-north"
                value={editor.targetTenantSlug}
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Название целевого тенанта</span>
              <Input
                onChange={(event) =>
                  setEditor((current) => ({ ...current, targetTenantLabel: event.target.value }))
                }
                placeholder="Пилотный запуск на севере"
                value={editor.targetTenantLabel}
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Status</span>
              <select
                className={fieldStyles}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    status: event.target.value as TenantOnboardingRunbookStatus,
                  }))
                }
                value={editor.status}
              >
                <option value="draft">Draft</option>
                <option value="prepared">Prepared</option>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Целевое время переключения</span>
              <Input
                onChange={(event) =>
                  setEditor((current) => ({ ...current, targetCutoverAt: event.target.value }))
                }
                type="datetime-local"
                value={editor.targetCutoverAt}
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Краткое описание runbook</span>
            <Input
              onChange={(event) =>
                setEditor((current) => ({ ...current, summary: event.target.value }))
              }
              placeholder="Краткое описание цикла развёртывания для оператора"
              value={editor.summary}
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Объём развёртывания</span>
            <Textarea
              onChange={(event) =>
                setEditor((current) => ({ ...current, rolloutScope: event.target.value }))
              }
              placeholder="Что расширяется, для кого и с какими ограничениями?"
              rows={4}
              value={editor.rolloutScope}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Заметки оператора</span>
              <Textarea
                onChange={(event) =>
                  setEditor((current) => ({ ...current, operatorNotes: event.target.value }))
                }
                placeholder="Операционный контекст, зависимости и предостережения"
                rows={5}
                value={editor.operatorNotes}
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
              <span>Заметки для передачи</span>
              <Textarea
                onChange={(event) =>
                  setEditor((current) => ({ ...current, handoffNotes: event.target.value }))
                }
                placeholder="Что должен знать следующий оператор или рецензент"
                rows={5}
                value={editor.handoffNotes}
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>План отката</span>
            <Textarea
              onChange={(event) =>
                setEditor((current) => ({ ...current, rollbackPlan: event.target.value }))
              }
              placeholder="Как откатить или приостановить развёртывание, если следующий тенант не готов"
              rows={4}
              value={editor.rollbackPlan}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!canSave} onClick={saveRunbook} type="button">
              {isSaving ? "Saving..." : editingId ? "Update runbook" : "Create runbook"}
            </Button>
            {editingId ? (
              <Button onClick={startNewDraft} type="button" variant="outline">
                Stop editing
              </Button>
            ) : null}
          </div>
        </div>

        <TenantOnboardingRunbookRecords
          latestRunbook={overview.latestRunbook}
          onEdit={loadEntry}
          runbooks={overview.runbooks}
        />
      </div>
    </div>
  );
}
