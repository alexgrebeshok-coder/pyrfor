import { EmailBriefDeliveryPanel } from "@/components/briefs/email-brief-delivery-panel";
import { TelegramBriefPolicyPanel } from "@/components/briefs/telegram-brief-policy-panel";
import { TelegramBriefDeliveryPanel } from "@/components/briefs/telegram-brief-delivery-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortfolioBrief, ProjectBrief } from "@/lib/briefs/types";

export function BriefRequestForm({
  portfolioBrief,
  projectBrief,
  projectOptions,
}: {
  portfolioBrief: PortfolioBrief;
  projectBrief: ProjectBrief | null;
  projectOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Предпросмотр доставки</CardTitle>
        <CardDescription>
          Форматы вывода, которые уже генерирует движок брифов: карточка на панели, сводка для Telegram и текст письма по SMTP.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="text-sm font-medium text-[var(--ink)]">Карточка портфеля на панели</div>
          <div className="mt-2 text-sm text-[var(--ink-soft)]">
            {portfolioBrief.formats.dashboardCard.summary}
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--ink-muted)]">
            {portfolioBrief.formats.dashboardCard.highlights.map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="text-sm font-medium text-[var(--ink)]">Сводка портфеля для Telegram</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--ink-soft)]">
            {portfolioBrief.formats.telegramDigest}
          </pre>
          <TelegramBriefDeliveryPanel projectOptions={projectOptions} />
          <TelegramBriefPolicyPanel projectOptions={projectOptions} />
        </div>

        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="text-sm font-medium text-[var(--ink)]">Предпросмотр email-доставки</div>
          <div className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Письмо по портфелю
          </div>
          <div className="mt-2 text-sm text-[var(--ink-soft)]">
            {portfolioBrief.formats.emailDigest.subject}
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--ink-muted)]">
            {portfolioBrief.formats.emailDigest.body}
          </pre>

          <div className="mt-4 text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Письмо по проекту
          </div>
          {projectBrief ? (
            <>
              <div className="mt-2 text-sm text-[var(--ink-soft)]">
                {projectBrief.formats.emailDigest.subject}
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--ink-muted)]">
                {projectBrief.formats.emailDigest.body}
              </pre>
            </>
          ) : (
            <div className="mt-2 text-sm text-[var(--ink-soft)]">
              Пока нет проекта, для которого можно собрать проектную сводку.
            </div>
          )}
          <EmailBriefDeliveryPanel projectOptions={projectOptions} />
        </div>
      </CardContent>
    </Card>
  );
}
