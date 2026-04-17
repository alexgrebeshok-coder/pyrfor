import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function GoalsPlaybookCard() {
  return (
    <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
      <CardHeader className="space-y-3">
        <CardTitle className="text-base tracking-[-0.06em]">
          Как это использовать
        </CardTitle>
        <CardDescription>
          Этот экран помогает руководителю быстро увидеть, какие цели требуют
          внимания, а какие уже можно удерживать на ритме.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            1. Смотрите на отклонения
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Начинайте с отстающих, перерасхода и перегруженных участников.
          </p>
        </div>
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            2. Переходите к проектам
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Каждую цель можно связать с конкретным проектом и его целями.
          </p>
        </div>
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            3. Превращайте сигнал в действие
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Следующий шаг должен быть понятен сразу, без поиска по всему приложению.
          </p>
        </div>
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            4. Возвращайтесь к портфелю
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
            Когда нужно увидеть полный контекст, откройте портфельную панель.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
