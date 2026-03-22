import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function IntegrationManifestsCard() {
  return (
    <Card className="h-full min-w-0">
      <CardHeader className="gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Integration manifests</CardTitle>
            <CardDescription>
              Подключай новые AI providers, GPS feeds и messenger APIs через env manifests,
              без правок core code.
            </CardDescription>
          </div>
          <Badge variant="info">Manifest-driven</Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">AI providers</Badge>
            <code className="break-all text-xs font-semibold text-[var(--ink)]">
              CEOCLAW_AI_PROVIDER_MANIFESTS
            </code>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
            Add OpenAI-compatible provider manifests with base URL, API key env var, and model list.
            They show up in <code className="text-xs">/settings/ai</code> and the chat registry.
          </p>
        </div>

        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Connectors</Badge>
            <code className="break-all text-xs font-semibold text-[var(--ink)]">
              CEOCLAW_CONNECTOR_MANIFESTS
            </code>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
            Add HTTP/JSON probe manifests for GPS, Telegram, email, webhook, or other enterprise
            integrations. The live health view appears in <code className="text-xs">/integrations</code>.
          </p>
        </div>

        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Operator flow
          </p>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">
            <li>1. Set JSON manifests in env.</li>
            <li>2. Restart the app so the registry reloads.</li>
            <li>3. Confirm live status in settings and integrations.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/settings/ai">
              Open AI settings
            </Link>
            <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/help">
              View operator docs
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
