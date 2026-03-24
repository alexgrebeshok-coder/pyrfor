"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea, fieldStyles } from "@/components/ui/field";
import type { VideoFactView } from "@/lib/video-facts/types";
import type { WorkReportMemberOption, WorkReportView } from "@/lib/work-reports/types";

function statusVariant(status: WorkReportView["status"]) {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "submitted":
    default:
      return "warning";
  }
}

function sourceLabel(source: WorkReportView["source"]) {
  switch (source) {
    case "telegram_bot":
      return "Telegram";
    case "import":
      return "Import";
    case "manual":
    default:
      return "Manual";
  }
}

function videoFactVariant(status: VideoFactView["verificationStatus"]) {
  return status === "verified" ? "success" : "info";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getDefaultReviewerId(input: {
  currentUserId?: string;
  members: WorkReportMemberOption[];
  reviewerId?: string | null;
}) {
  if (input.reviewerId && input.members.some((member) => member.id === input.reviewerId)) {
    return input.reviewerId;
  }

  if (input.currentUserId && input.members.some((member) => member.id === input.currentUserId)) {
    return input.currentUserId;
  }

  return input.members[0]?.id ?? "";
}

export function ReportReviewCard({
  members,
  report,
  videoFacts,
}: {
  members: WorkReportMemberOption[];
  report: WorkReportView | null;
  videoFacts: VideoFactView[];
}) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const { accessProfile, allowed: canManageReview } = usePlatformPermission(
    "REVIEW_WORK_REPORTS",
    "delivery"
  );
  const relatedVideoFacts = useMemo(
    () => (report ? videoFacts.filter((item) => item.reportId === report.id) : []),
    [report, videoFacts]
  );
  const [reviewerId, setReviewerId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    setReviewerId(
      getDefaultReviewerId({
        currentUserId: currentUser?.id,
        members,
        reviewerId: report?.reviewerId,
      })
    );
    setReviewComment(report?.reviewComment ?? "");
    setError(null);
    setMessage(null);
  }, [currentUser?.id, members, report?.id, report?.reviewComment, report?.reviewerId]);

  const canReview = canManageReview && report?.status === "submitted" && members.length > 0;

  const submitReview = async (decision: "approve" | "reject") => {
    if (!report) {
      return;
    }

    if (!reviewerId) {
      setError("Выберите проверяющего перед review action.");
      return;
    }

    if (decision === "reject" && reviewComment.trim().length === 0) {
      setError("Для отклонения отчёта нужен review comment.");
      return;
    }

    setSubmittingAction(decision);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/work-reports/${report.id}/${decision}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewerId,
          reviewComment: reviewComment.trim().length > 0 ? reviewComment : null,
        }),
      });
      const payload = (await response.json()) as
        | WorkReportView
        | {
            error?: {
              message?: string;
            };
          };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error?.message
            ? payload.error.message
            : "Не удалось выполнить review action."
        );
      }

      const nextStatus =
        "status" in payload ? payload.status : decision === "approve" ? "approved" : "rejected";
      setMessage(
        nextStatus === "approved"
          ? "Отчёт подтверждён. Теперь его можно отправить в Action Pilot ниже."
          : "Отчёт отклонён. Исправьте данные и верните его в submitted, чтобы открыть review заново."
      );
      router.refresh();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Не удалось выполнить review action."
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  if (!report) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Review panel</CardTitle>
          <CardDescription>
            Выберите отчёт из ленты, чтобы увидеть approval context и reviewer controls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Пока нет выбранного отчёта для review.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Review panel</CardTitle>
        <CardDescription>
          Approval теперь управляет handoff в Action Pilot: сначала review, потом signal packet.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
            <Badge variant="neutral">{sourceLabel(report.source)}</Badge>
            <Badge variant="info">{formatDate(report.reportDate)}</Badge>
          </div>

          <div>
            <div className="text-sm font-medium text-[var(--ink)]">
              {report.reportNumber} · {report.section}
            </div>
            <div className="mt-1 text-sm text-[var(--ink-soft)]">{report.workDescription}</div>
          </div>

          <div className="grid gap-2 text-xs text-[var(--ink-soft)]">
            <div>Проект: {report.project.name}</div>
            <div>Автор: {report.author.name}</div>
            <div>Отправлен: {formatDateTime(report.submittedAt)}</div>
            {report.reviewedAt ? <div>Reviewed: {formatDateTime(report.reviewedAt)}</div> : null}
            {report.reviewer ? <div>Reviewer: {report.reviewer.name}</div> : null}
          </div>

          {report.reviewComment ? (
            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              <span className="font-medium text-[var(--ink)]">Review comment:</span>{" "}
              {report.reviewComment}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-[var(--ink)]">Approval context</div>
            <Badge variant={relatedVideoFacts.length > 0 ? "info" : "warning"}>
              {relatedVideoFacts.length} linked video fact
              {relatedVideoFacts.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {relatedVideoFacts.length > 0 ? (
            <div className="grid gap-2">
              {relatedVideoFacts.slice(0, 3).map((fact) => (
                <div
                  className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-3"
                  key={fact.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={videoFactVariant(fact.verificationStatus)}>
                      {fact.verificationStatus}
                    </Badge>
                    <span className="text-xs text-[var(--ink-soft)]">
                      {Math.round(fact.confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--ink)]">{fact.title}</div>
                  {fact.summary ? (
                    <div className="mt-1 text-sm text-[var(--ink-soft)]">{fact.summary}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              Пока нет linked video facts. Review всё равно доступен, но approval пройдёт с более
              слабым evidence context.
            </div>
          )}

          {report.issues ? (
            <div className="rounded-[14px] border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">Блокеры:</span> {report.issues}
            </div>
          ) : null}
        </div>

        {message ? (
          <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4">
          {!canManageReview ? (
            <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              Роль {accessProfile.role} видит approval context, но не может approve/reject отчёты в
              delivery workspace.
            </div>
          ) : null}

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Проверяющий</span>
            <select
              className={fieldStyles}
              disabled={!canReview || submittingAction !== null}
              onChange={(event) => setReviewerId(event.target.value)}
              value={reviewerId}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.role ? ` · ${member.role}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
            <span>Review comment</span>
            <Textarea
              disabled={!canReview || submittingAction !== null}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder="Что именно подтверждено, чего не хватает, какие исправления нужны."
              value={reviewComment}
            />
          </label>

          <div className="text-xs leading-6 text-[var(--ink-soft)]">
            Approve допускает пустой комментарий, reject требует пояснение. Только approved отчёты
            открывают Action Pilot ниже.
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={!canReview || submittingAction !== null}
              onClick={() => void submitReview("approve")}
            >
              {submittingAction === "approve" ? "Подтверждаю..." : "Approve report"}
            </Button>
            <Button
              disabled={!canReview || submittingAction !== null}
              onClick={() => void submitReview("reject")}
              variant="danger"
            >
              {submittingAction === "reject" ? "Отклоняю..." : "Reject report"}
            </Button>
          </div>

          {!canReview ? (
            <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              {!canManageReview
                ? "Approval controls доступны только ролям PM, EXEC и OPS."
                : report.status === "approved"
                ? "Этот отчёт уже approved и теперь доступен в Action Pilot."
                : report.status === "rejected"
                  ? "Этот отчёт уже отклонён. Обновите его, чтобы вернуть в submitted и открыть review заново."
                  : "Для review нужен хотя бы один доступный reviewer."}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
