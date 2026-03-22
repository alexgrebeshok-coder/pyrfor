import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KnowledgeLoopOverview, KnowledgePlaybookView } from "@/lib/knowledge";

function maturityVariant(maturity: KnowledgePlaybookView["maturity"]) {
  return maturity === "repeated" ? "success" : "info";
}

function maturityLabel(maturity: KnowledgePlaybookView["maturity"]) {
  return maturity === "repeated" ? "Повторяющийся" : "Формируется";
}

function queueVariant(status: KnowledgeLoopOverview["activeGuidance"][number]["queueStatus"]) {
  switch (status) {
    case "resolved":
      return "success";
    case "acknowledged":
      return "info";
    case "open":
    default:
      return "warning";
  }
}

function queueLabel(status: KnowledgeLoopOverview["activeGuidance"][number]["queueStatus"]) {
  switch (status) {
    case "resolved":
      return "Закрыто";
    case "acknowledged":
      return "Подтверждено";
    case "open":
    default:
      return "Открыто";
  }
}

function urgencyVariant(urgency: KnowledgeLoopOverview["activeGuidance"][number]["urgency"]) {
  switch (urgency) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
    default:
      return "neutral";
  }
}

function urgencyLabel(urgency: KnowledgeLoopOverview["activeGuidance"][number]["urgency"]) {
  switch (urgency) {
    case "critical":
      return "Критично";
    case "high":
      return "Высокий";
    case "medium":
      return "Средний";
    case "low":
    default:
      return "Низкий";
  }
}

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function KnowledgeLoopCard({
  overview,
  availabilityNote,
}: {
  overview?: KnowledgeLoopOverview;
  availabilityNote?: string;
}) {
  // Defensive: show availability note if overview missing
  if (!overview || availabilityNote) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Контур знаний и бенчмарков</CardTitle>
          <CardDescription>
            Переиспользуемые плейбуки собираются из повторяющихся эскалаций и возвращаются в управленческие рекомендации вместе с окнами реакции по бенчмаркам.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            {availabilityNote || "Функция в разработке"}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Контур знаний и бенчмарков</CardTitle>
            <CardDescription>
              Переиспользуемые плейбуки собираются из повторяющихся эскалаций и возвращаются в управленческие рекомендации вместе с окнами реакции по бенчмаркам.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Плейбуки {overview.summary?.totalPlaybooks ?? 0}</Badge>
            <Badge variant="success">Повторяются {overview.summary?.repeatedPlaybooks ?? 0}</Badge>
            <Badge variant="warning">Активные рекомендации {overview.summary?.benchmarkedGuidance ?? 0}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-3">
          <div>
            <div className="font-medium text-[var(--ink)]">Отслеживаемые паттерны</div>
            <div className="mt-1">{overview.summary?.trackedPatterns ?? 0}</div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Повторяющиеся плейбуки</div>
            <div className="mt-1">{overview.summary?.repeatedPlaybooks ?? 0}</div>
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">Рекомендации по бенчмаркам</div>
            <div className="mt-1">{overview.summary?.benchmarkedGuidance ?? 0}</div>
          </div>
        </div>

        {availabilityNote ? (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            {availabilityNote}
          </div>
        ) : null}

        {(overview.playbooks?.length ?? 0) > 0 ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="grid gap-3">
              {overview.playbooks.map((playbook) => (
                <div
                  className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  key={playbook.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ink)]">{playbook.title}</div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {playbook.proposalType ?? "ручной"} · {playbook.purpose ?? "общий"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={maturityVariant(playbook.maturity)}>{maturityLabel(playbook.maturity)}</Badge>
                      <Badge variant="neutral">{playbook.totalOccurrences} случаев</Badge>
                      <Badge variant="info">{playbook.benchmark.ackTargetHours}ч на подтверждение</Badge>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-[var(--ink-soft)]">{playbook.guidance}</div>

                  <div className="mt-3 grid gap-2 text-xs text-[var(--ink-soft)] md:grid-cols-2 xl:grid-cols-4">
                    <div>Открыто: {playbook.openOccurrences}</div>
                    <div>Решено: {playbook.resolvedOccurrences}</div>
                    <div>Процент решений: {formatRate(playbook.benchmark.resolutionRate)}</div>
                    <div>Процент нарушений: {formatRate(playbook.benchmark.breachRate)}</div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    {playbook.lessons.map((lesson, index) => (
                      <div
                        className="rounded-[14px] border border-[var(--line)]/70 bg-[var(--surface)]/70 px-3 py-2 text-sm text-[var(--ink-soft)]"
                        key={`${playbook.id}-lesson-${index}`}
                      >
                        {lesson}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3">
              <div className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <div className="font-medium text-[var(--ink)]">Активные рекомендации по бенчмаркам</div>
                <div className="mt-1 text-sm text-[var(--ink-soft)]">
                  Открытые эскалации наследуют ближайший переиспользуемый playbook, чтобы следующий операторский шаг был опорным, а не импровизацией.
                </div>
              </div>

              {overview.activeGuidance.length > 0 ? (
                overview.activeGuidance.map((item) => (
                  <div
                    className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                    key={item.escalationId}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--ink)]">{item.title}</div>
                        <div className="mt-1 text-xs text-[var(--ink-soft)]">
                          {item.projectName ?? "Проект неизвестен"} · {item.playbookTitle}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={urgencyVariant(item.urgency)}>{urgencyLabel(item.urgency)}</Badge>
                        <Badge variant={queueVariant(item.queueStatus)}>{queueLabel(item.queueStatus)}</Badge>
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-[var(--ink-soft)]">{item.recommendedAction}</div>
                    <div className="mt-3 text-xs text-[var(--ink-soft)]">
                      Benchmark: {item.benchmarkSummary}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                  Сейчас нет открытых эскалаций, которые ждут рекомендаций по бенчмаркам.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Пока нет переиспользуемых плейбуков. Эта карточка начинает работать, когда в очереди эскалаций накапливаются повторяющиеся операторские сценарии.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
