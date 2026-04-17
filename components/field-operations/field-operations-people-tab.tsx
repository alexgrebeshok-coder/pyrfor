import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { FieldTeamMember } from "@/components/field-operations/field-operations.types";

export function FieldOperationsPeopleTab({
  teamMembers,
}: {
  teamMembers: FieldTeamMember[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Люди и покрытие</CardTitle>
        <CardDescription>
          Кто в поле, у кого перегрузка, и какие проекты уже живут в одном полевом
          контуре.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-3">
        {teamMembers.length > 0 ? (
          teamMembers.map((member) => {
            const activeProjectNames = member.projects
              .filter((project) => project.status === "active" || project.status === "at_risk")
              .slice(0, 3)
              .map((project) => project.name);

            return (
              <div
                className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={member.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-[var(--ink)]">
                      {member.name}
                    </div>
                    <div className="mt-1 text-sm text-[var(--ink-soft)]">
                      {member.role}
                    </div>
                  </div>
                  <Badge variant={member.capacity > 80 ? "warning" : "success"}>
                    {member.capacity}% загрузки
                  </Badge>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-[var(--ink-muted)]">
                  <div>Проектов: {member.projects.length}</div>
                  <div>
                    Покрытие:{" "}
                    {activeProjectNames.length > 0
                      ? activeProjectNames.join(", ")
                      : "пока без активного поля"}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <Card className="border-dashed xl:col-span-3">
            <CardContent className="p-4 text-sm text-[var(--ink-soft)]">
              Список людей появится, когда live database отдаст team members.
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
