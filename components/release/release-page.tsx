import Link from "next/link";
import { ArrowUpRight, Download, Globe, Laptop2, Rocket, ShieldCheck, Smartphone, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getReleaseConfig, isExternalReleaseHref } from "@/lib/release";
import { cn } from "@/lib/utils";

const {
  appUrl,
  desktopDownloadUrl,
  iphoneDownloadUrl,
  releaseVersion,
} = getReleaseConfig();

function isExternalHref(href: string) {
  return isExternalReleaseHref(href);
}

function ActionLink({
  href,
  label,
  variant = "outline",
}: {
  href: string;
  label: string;
  variant?: "default" | "outline";
}) {
  const className = cn(
    buttonVariants({ variant, size: "lg" }),
    variant === "default"
      ? "bg-white text-slate-950 hover:bg-slate-100"
      : "border-white/18 bg-white/10 text-white hover:bg-white/15"
  );

  if (isExternalHref(href)) {
    return (
      <a className={className} href={href} rel="noreferrer" target="_blank">
        {label}
        <ArrowUpRight className="h-4 w-4" />
      </a>
    );
  }

  return (
    <Link className={className} href={href}>
      {label}
      <ArrowUpRight className="h-4 w-4" />
    </Link>
  );
}

function ChannelCard({
  actionHref,
  actionLabel,
  badge,
  description,
  anchorId,
  configured,
  icon: Icon,
  note,
  steps,
  statusLabel,
  title,
}: {
  actionHref: string;
  actionLabel: string;
  badge: string;
  description: string;
  anchorId: string;
  configured: boolean;
  icon: typeof Download;
  note: string;
  steps?: string[];
  statusLabel: string;
  title: string;
}) {
  return (
    <Card
      className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96 shadow-[0_14px_50px_rgba(15,23,42,.06)]"
      id={anchorId}
    >
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-soft)] text-[var(--brand)]">
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="info">{badge}</Badge>
            <Badge variant={configured ? "success" : "neutral"}>{statusLabel}</Badge>
          </div>
        </div>
        <div>
          <CardTitle className="text-xl tracking-[-0.05em]">{title}</CardTitle>
          <CardDescription className="mt-2 text-sm leading-6">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ActionLink href={actionHref} label={actionLabel} />
        <p className="text-sm leading-6 text-[var(--ink-soft)]">{note}</p>
        {steps ? (
          <ul className="space-y-2 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/70 px-4 py-3 text-sm leading-6 text-[var(--ink-soft)]">
            {steps.map((step) => (
              <li className="flex gap-3" key={step}>
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ReleasePage() {
  const webActionHref = appUrl;
  const desktopActionHref = desktopDownloadUrl;
  const iphoneActionHref = iphoneDownloadUrl;
  const webConfigured = isExternalHref(webActionHref);
  const desktopConfigured = isExternalHref(desktopActionHref);
  const iphoneConfigured = isExternalHref(iphoneActionHref);

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_35%),linear-gradient(180deg,var(--surface) 0%,var(--surface-panel) 100%)] px-4 py-6 text-[var(--ink)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#2563eb_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,.18)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.2fr_.8fr] lg:p-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">Центр загрузок</Badge>
                <Badge variant="info">v{releaseVersion}</Badge>
                <Badge variant="success">Живое ядро</Badge>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.08em] sm:text-5xl">
                  Установите CEOClaw в любом месте.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-100/84">
                  Одна живая продуктовая основа и три способа доставки. Используйте размещённое веб-приложение,
                  подписанную оболочку macOS или оболочку для iPhone, не меняя рабочий процесс.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <ActionLink href={webActionHref} label="Открыть веб-версию" variant="default" />
                <ActionLink href={desktopActionHref} label="Установить для macOS" />
                <ActionLink href={iphoneActionHref} label="Установить на iPhone" />
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Globe className="h-4 w-4" />
                    Веб
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Размещено</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">Источник истины для всех экранов.</p>
                </div>
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Laptop2 className="h-4 w-4" />
                    macOS
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Tauri v2</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Восстановление окна, горячие клавиши, трей и живой web-shell.
                  </p>
                </div>
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Smartphone className="h-4 w-4" />
                    iPhone
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Capacitor</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Безопасные области, touch-first навигация и те же живые данные.
                  </p>
                </div>
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <ShieldCheck className="h-4 w-4" />
                    Поддержка
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Готово</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Runbook, rollback и версии заметок собраны в одном месте.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
            <ChannelCard
            actionHref={webActionHref}
            actionLabel="Открыть веб-приложение"
            badge="Веб-приложение"
            configured={webConfigured}
            description="Откройте живой продукт в браузере. Это основной источник истины."
            anchorId="web"
            icon={Globe}
            note="Лучше всего подходит для входа, авторизации и общих проектных данных."
            statusLabel={webConfigured ? "Живой URL" : "Локальный предпросмотр"}
            steps={[
              "Войдите в систему или создайте аккаунт.",
              "Откройте панель нужного проекта.",
              "Продолжайте работать на одних и тех же живых данных во всех оболочках.",
            ]}
            title="Размещённое веб-приложение"
          />

          <ChannelCard
            actionHref={desktopActionHref}
            actionLabel={desktopActionHref.startsWith("#") ? "Посмотреть шаги установки macOS" : "Скачать сборку для macOS"}
            badge="macOS"
            configured={desktopConfigured}
            description="Лёгкая Tauri-оболочка над живым продуктом с горячими клавишами, треем и восстановлением окна."
            anchorId="desktop"
            icon={Laptop2}
            note="Когда URL релиза настроен, карточка должна вести на подписанный DMG или ZIP."
            statusLabel={desktopConfigured ? "Ссылка на загрузку готова" : "Нужна ссылка на загрузку"}
            steps={[
              "Укажите NEXT_PUBLIC_APP_URL на живой production URL.",
              "Скачайте подписанный DMG или ZIP по ссылке релиза.",
              "Откройте приложение и дайте ему перейти в живой веб-продукт.",
            ]}
            title="Приложение для macOS"
          />

          <ChannelCard
            actionHref={iphoneActionHref}
            actionLabel={iphoneActionHref.startsWith("#") ? "Посмотреть шаги установки iPhone" : "Открыть TestFlight / App Store"}
            badge="iPhone"
            configured={iphoneConfigured}
            description="Оболочка Capacitor вокруг того же живого веб-приложения, настроенная на безопасные области и touch-first сценарии."
            anchorId="iphone"
            icon={Smartphone}
            note="Используйте TestFlight для бета-распространения, затем переходите в App Store."
            statusLabel={iphoneConfigured ? "Установка готова" : "Нужна ссылка на TestFlight"}
            steps={[
              "Откройте ссылку на TestFlight или App Store на этой странице.",
              "Установите приложение и войдите под своим аккаунтом CEOClaw.",
              "Пользуйтесь теми же проектами, задачами, календарём и ИИ на телефоне.",
            ]}
            title="Приложение для iPhone"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                <CardTitle className="text-2xl tracking-[-0.06em]">Заметки релиза</CardTitle>
              </div>
              <CardDescription>
                Этот релиз сфокусирован на понятной установке и живом продукте без лишней магии.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {[
                  "Одна общая живая модель данных для веба, десктопа и iPhone.",
                  "Десктопная оболочка умеет восстанавливать окно, поддерживает нативные шорткаты и трей.",
                  "Оболочка для iPhone честно работает с безопасными областями, touch-target'ами и сохранением сессии.",
                  "ИИ теперь показывает видимый council trace, чтобы можно было проверить, как был сформирован ответ.",
                ].map((item) => (
                  <div
                    className="flex items-start gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)]/70 px-4 py-3"
                    key={item}
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <p className="text-sm leading-6 text-[var(--ink-soft)]">{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-[var(--brand)]" />
                  <CardTitle className="text-2xl tracking-[-0.06em]">Нужна помощь?</CardTitle>
                </div>
                <CardDescription>
                  Раздел поддержки остаётся внутри приложения и ведёт к операторским заметкам и быстрым сценариям запуска.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ActionLink href="/help" label="Открыть помощь и поддержку" />
                <div className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4">
                  <p className="text-sm font-medium text-[var(--ink)]">Что делать дальше</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                    Выберите нужную оболочку, установите её и продолжайте работать на тех же живых данных.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[var(--brand)]" />
                  <CardTitle className="text-2xl tracking-[-0.06em]">Статус распространения</CardTitle>
                </div>
                <CardDescription>
                  Здесь видно, подключён ли каждый канал к реальному публичному адресу или всё ещё указывает на локальную заглушку.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {[
                  {
                    configured: webConfigured,
                    href: webActionHref,
                    label: "Веб",
                  },
                  {
                    configured: desktopConfigured,
                    href: desktopActionHref,
                    label: "macOS",
                  },
                  {
                    configured: iphoneConfigured,
                    href: iphoneActionHref,
                    label: "iPhone",
                  },
                ].map((item) => (
                  <div
                    className="flex items-start justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)]/70 px-4 py-3"
                    key={item.label}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-[var(--ink)]">{item.label}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {item.configured ? item.href : "заглушка ещё не настроена"}
                      </p>
                    </div>
                    <Badge variant={item.configured ? "success" : "neutral"}>
                      {item.configured ? "Живой" : "Заглушка"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
