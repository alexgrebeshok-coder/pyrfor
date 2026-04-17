"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkReportActionPilotAccessCard({
  role,
}: {
  role: string;
}) {
  return (
    <Card className="border-[var(--line)] bg-[var(--surface-panel)]">
      <CardHeader>
        <CardTitle>Work Report to Action</CardTitle>
        <CardDescription>
          Role-aware surface: action packets доступны только ролям, которым разрешён review в
          delivery workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-[14px] border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
          Роль {role} может читать approved handoff, но не может запускать Action Pilot.
        </div>
      </CardContent>
    </Card>
  );
}
