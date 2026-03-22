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
import type { PortfolioBrief, ProjectBrief } from "@/lib/briefs/types";

type BriefRow = {
  freshness: string;
  highlights: number;
  scope: string;
  status: "Живой" | "Нужно внимание";
  title: string;
};

function buildRows(
  portfolioBrief: PortfolioBrief,
  projectBriefs: ProjectBrief[]
): BriefRow[] {
  const rows: BriefRow[] = [
    {
      freshness: formatFreshness(portfolioBrief.generatedAt),
      highlights: portfolioBrief.topAlerts.length,
      scope: "Портфель",
      status: portfolioBrief.topAlerts.length > 0 ? "Нужно внимание" : "Живой",
      title: portfolioBrief.headline,
    },
  ];

  for (const brief of projectBriefs) {
    rows.push({
      freshness: formatFreshness(brief.generatedAt),
      highlights: brief.topAlerts.length,
      scope: brief.project.name,
      status: brief.topAlerts.length > 0 ? "Нужно внимание" : "Живой",
      title: brief.headline,
    });
  }

  return rows;
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function BriefQueueTable({
  portfolioBrief,
  projectBriefs,
}: {
  portfolioBrief: PortfolioBrief;
  projectBriefs: ProjectBrief[];
}) {
  const rows = buildRows(portfolioBrief, projectBriefs);

  return (
      <Card>
      <CardHeader>
        <CardTitle>Живые сводки для руководства</CardTitle>
        <CardDescription>
          Сводка портфеля и сводки по проектам, уже собранные текущим движком сигналов и брифов.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Заголовок</TableHead>
              <TableHead>Контур</TableHead>
              <TableHead>Сигналы</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Сформировано</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((brief) => (
              <TableRow key={`${brief.scope}:${brief.title}`}>
                <TableCell className="font-medium">{brief.title}</TableCell>
                <TableCell>{brief.scope}</TableCell>
                <TableCell>{brief.highlights}</TableCell>
                <TableCell>
                  <Badge variant={brief.status === "Нужно внимание" ? "warning" : "success"}>
                    {brief.status}
                  </Badge>
                </TableCell>
                <TableCell>{brief.freshness}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
