import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import type {
  PilotFeedbackItemView,
  PilotFeedbackListResult,
  PilotFeedbackStatus,
} from "@/lib/pilot-feedback";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";

import {
  formatTimestamp,
  ownerVariant,
  severityVariant,
  statusVariant,
  targetTypeLabel,
} from "@/components/pilot-feedback/pilot-feedback-utils";

export function PilotFeedbackLedger({
  feedback,
  liveFeedbackReady,
  members,
  savingId,
  onUpdateFeedback,
}: {
  feedback: PilotFeedbackListResult;
  liveFeedbackReady: boolean;
  members: WorkReportMemberOption[];
  savingId: string | null;
  onUpdateFeedback: (
    item: PilotFeedbackItemView,
    body: {
      ownerId?: string | null;
      status?: PilotFeedbackStatus;
    }
  ) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Feedback ledger</CardTitle>
            <CardDescription>
              Open, in-review, and resolved pilot feedback linked to real workflow
              artifacts.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">Open {feedback.summary.open}</Badge>
            <Badge variant="info">Review {feedback.summary.inReview}</Badge>
            <Badge variant="success">Resolved {feedback.summary.resolved}</Badge>
            <Badge variant="danger">Critical {feedback.summary.critical}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {liveFeedbackReady ? (
          feedback.items.length > 0 ? (
            <div className="grid gap-3">
              {feedback.items.map((item) => {
                const assignedOwnerId =
                  item.owner.mode === "assigned" ? item.owner.id ?? "" : "";

                return (
                  <div
                    className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                    key={item.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--ink)]">
                          {item.summary}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {item.targetLabel} · {item.projectName ?? "No linked project"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="neutral">{targetTypeLabel(item.targetType)}</Badge>
                        <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                      </div>
                    </div>

                    {item.details ? (
                      <div className="mt-3 text-sm text-[var(--ink-soft)]">
                        {item.details}
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          Owner
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant={ownerVariant(item)}>{item.owner.mode}</Badge>
                          <span className="font-medium text-[var(--ink)]">
                            {item.owner.name}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {item.owner.role ?? "No role attached"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          Source
                        </div>
                        <div className="mt-1 font-medium text-[var(--ink)]">
                          {item.sourceLabel}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          Opened {formatTimestamp(item.openedAt)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          Reporter
                        </div>
                        <div className="mt-1 font-medium text-[var(--ink)]">
                          {item.reporterName ?? "Operator"}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          Updated {formatTimestamp(item.updatedAt)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          Resolution
                        </div>
                        <div className="mt-1 font-medium text-[var(--ink)]">
                          {item.resolvedAt
                            ? formatTimestamp(item.resolvedAt)
                            : "Still active"}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {item.resolutionNote ?? "No resolution note"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.links.map((link) => (
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={link.href}
                          key={`${item.id}:${link.href}`}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 rounded-[14px] border border-[var(--line)]/80 bg-[var(--surface)]/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
                        <span>Assign owner</span>
                        <select
                          className={fieldStyles}
                          disabled={savingId === item.id}
                          onChange={(event) =>
                            onUpdateFeedback(item, {
                              ownerId: event.target.value || null,
                            })
                          }
                          value={assignedOwnerId}
                        >
                          <option value="">Unassigned</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} {member.role ? `· ${member.role}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap items-end gap-2">
                        {item.status === "open" ? (
                          <Button
                            disabled={savingId === item.id}
                            onClick={() => onUpdateFeedback(item, { status: "in_review" })}
                            size="sm"
                            variant="outline"
                          >
                            Mark in review
                          </Button>
                        ) : null}
                        {item.status !== "resolved" ? (
                          <Button
                            disabled={savingId === item.id}
                            onClick={() => onUpdateFeedback(item, { status: "resolved" })}
                            size="sm"
                          >
                            Resolve
                          </Button>
                        ) : (
                          <Button
                            disabled={savingId === item.id}
                            onClick={() => onUpdateFeedback(item, { status: "open" })}
                            size="sm"
                            variant="outline"
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              No pilot feedback yet. Open this page from command center or audit packs to
              prefill one real workflow artifact.
            </div>
          )
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Demo mode or missing live database configuration keeps pilot feedback in a
            safe preview state.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
