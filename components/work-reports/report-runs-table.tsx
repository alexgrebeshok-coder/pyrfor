import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkReportView } from "@/lib/work-reports/types";

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

export function ReportRunsTable({ reports }: { reports: WorkReportView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Лента полевых отчётов</CardTitle>
        <CardDescription>
          Живые отчёты по участкам с привязкой к проекту, автору и review-статусу.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-6 text-sm text-[var(--ink-soft)]">
            Отчётов пока нет. Создайте первый отчёт справа, чтобы проверить цикл submit/review.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Отчёт</TableHead>
                <TableHead>Проект</TableHead>
                <TableHead>Автор</TableHead>
                <TableHead>Дата смены</TableHead>
                <TableHead>Источник</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Обновлён</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="max-w-[280px]">
                    <Link
                      className="font-medium text-[var(--ink)] underline-offset-4 hover:underline"
                      href={`/work-reports?query=${encodeURIComponent(report.reportNumber)}`}
                    >
                      {report.reportNumber}
                    </Link>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">{report.section}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">
                      {report.workDescription}
                    </div>
                  </TableCell>
                  <TableCell>{report.project.name}</TableCell>
                  <TableCell>{report.author.name}</TableCell>
                  <TableCell>{formatDate(report.reportDate)}</TableCell>
                  <TableCell>{sourceLabel(report.source)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
                      {report.reviewComment ? (
                        <span className="text-xs text-[var(--ink-soft)]">
                          {report.reviewComment}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatDateTime(report.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
