"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAIContext } from "@/lib/ai/context-provider";
import { useLocale } from "@/contexts/locale-context";

type EditableProviderId = "openai" | "openrouter" | "zai";

type ProviderDraft = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  models: string;
};

export default function AISettingsPage() {
  const { t } = useLocale();
  const {
    features,
    isReady,
    isSavingSettings,
    providerRegistry,
    saveSettings,
    selectedModel,
    selectedProvider,
    usageSummary,
  } = useAIContext();
  const [providerDrafts, setProviderDrafts] = useState<Record<EditableProviderId, ProviderDraft>>({
    openrouter: {
      apiKey: "",
      baseUrl: "",
      defaultModel: "",
      enabled: true,
      models: "",
    },
    zai: {
      apiKey: "",
      baseUrl: "",
      defaultModel: "",
      enabled: true,
      models: "",
    },
    openai: {
      apiKey: "",
      baseUrl: "",
      defaultModel: "",
      enabled: true,
      models: "",
    },
  });
  const [selectedProviderDraft, setSelectedProviderDraft] = useState(selectedProvider);
  const [selectedModelDraft, setSelectedModelDraft] = useState(selectedModel);
  const [featureDrafts, setFeatureDrafts] = useState(features);

  useEffect(() => {
    const nextDrafts = providerRegistry.reduce<Record<EditableProviderId, ProviderDraft>>(
      (accumulator, provider) => {
        if (provider.id === "local") {
          return accumulator;
        }

        accumulator[provider.id] = {
          apiKey: "",
          baseUrl: provider.baseUrl,
          defaultModel: provider.defaultModel,
          enabled: provider.enabled,
          models: provider.models.join(", "),
        };

        return accumulator;
      },
      {
        openrouter: {
          apiKey: "",
          baseUrl: "",
          defaultModel: "",
          enabled: true,
          models: "",
        },
        zai: {
          apiKey: "",
          baseUrl: "",
          defaultModel: "",
          enabled: true,
          models: "",
        },
        openai: {
          apiKey: "",
          baseUrl: "",
          defaultModel: "",
          enabled: true,
          models: "",
        },
      }
    );

    setProviderDrafts(nextDrafts);
    setSelectedProviderDraft(selectedProvider);
    setSelectedModelDraft(selectedModel);
    setFeatureDrafts(features);
  }, [features, providerRegistry, selectedModel, selectedProvider]);

  const selectedProviderModels = useMemo(
    () =>
      providerRegistry.find((provider) => provider.id === selectedProviderDraft)?.models ?? [],
    [providerRegistry, selectedProviderDraft]
  );

  const handleSave = async () => {
    await saveSettings({
      selectedProvider: selectedProviderDraft,
      selectedModel: selectedModelDraft,
      features: featureDrafts,
      providers: (Object.entries(providerDrafts) as Array<[EditableProviderId, ProviderDraft]>).map(
        ([id, draft]) => ({
          id,
          apiKey: draft.apiKey.trim() || undefined,
          baseUrl: draft.baseUrl.trim(),
          defaultModel: draft.defaultModel.trim(),
          enabled: draft.enabled,
          models: draft.models
            .split(",")
            .map((model) => model.trim())
            .filter((model) => model.length > 0),
        })
      ),
    });
  };

  if (!isReady) {
    return (
      <div className="grid gap-4">
        <Card className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-32 rounded-full bg-[var(--line)]/70" />
            <div className="h-8 w-64 rounded-full bg-[var(--line)]/60" />
            <div className="h-24 rounded-[18px] bg-[var(--line)]/50" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Link className="inline-flex items-center gap-2 text-sm text-[var(--ink-soft)]" href="/settings">
              <ArrowLeft className="h-4 w-4" />
              {t("action.previous")}
            </Link>
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--panel-soft)] px-3 py-1 text-xs font-medium text-[var(--brand)]">
                <Sparkles className="h-3.5 w-3.5" />
                {t("ai.settings.badge")}
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {t("ai.settings.title")}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                {t("ai.settings.description")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{selectedProviderDraft}</Badge>
            {selectedModelDraft ? <Badge variant="neutral">{selectedModelDraft}</Badge> : null}
            <Button disabled={isSavingSettings} onClick={() => void handleSave()}>
              <Save className="h-4 w-4" />
              {isSavingSettings ? t("action.saving") : t("action.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("ai.settings.providersTitle")}</CardTitle>
            <CardDescription>{t("ai.settings.providersDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {providerRegistry
              .filter((provider) => provider.id !== "local")
              .map((provider) => {
                const draft = providerDrafts[provider.id as EditableProviderId];

                return (
                  <div
                    key={provider.id}
                    className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/45 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">{provider.label}</p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {provider.hasApiKey
                            ? t("ai.settings.apiKeyConfigured", {
                                key: provider.apiKeyMasked ?? "••••",
                              })
                            : t("ai.settings.apiKeyMissing")}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                        <input
                          checked={draft.enabled}
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.id]: {
                                ...current[provider.id as EditableProviderId],
                                enabled: event.target.checked,
                              },
                            }))
                          }
                          type="checkbox"
                        />
                        {t("ai.settings.enabled")}
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {t("ai.settings.apiKeyLabel")}
                        </label>
                        <input
                          className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.id]: {
                                ...current[provider.id as EditableProviderId],
                                apiKey: event.target.value,
                              },
                            }))
                          }
                          placeholder={provider.apiKeyMasked ?? t("ai.settings.apiKeyPlaceholder")}
                          type="password"
                          value={draft.apiKey}
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {t("ai.settings.defaultModelLabel")}
                        </label>
                        <input
                          className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.id]: {
                                ...current[provider.id as EditableProviderId],
                                defaultModel: event.target.value,
                              },
                            }))
                          }
                          value={draft.defaultModel}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {t("ai.settings.baseUrlLabel")}
                        </label>
                        <input
                          className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.id]: {
                                ...current[provider.id as EditableProviderId],
                                baseUrl: event.target.value,
                              },
                            }))
                          }
                          value={draft.baseUrl}
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          {t("ai.settings.modelsLabel")}
                        </label>
                        <input
                          className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.id]: {
                                ...current[provider.id as EditableProviderId],
                                models: event.target.value,
                              },
                            }))
                          }
                          value={draft.models}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("ai.settings.selectionTitle")}</CardTitle>
              <CardDescription>{t("ai.settings.selectionDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  {t("ai.settings.activeProviderLabel")}
                </label>
                <select
                  className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                  onChange={(event) =>
                    setSelectedProviderDraft(
                      event.target.value as "local" | "openai" | "openrouter" | "zai"
                    )
                  }
                  value={selectedProviderDraft}
                >
                  {providerRegistry.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  {t("ai.settings.activeModelLabel")}
                </label>
                <select
                  className="h-10 rounded-[12px] border border-[var(--line)] bg-[var(--surface-panel)] px-3 text-sm"
                  onChange={(event) => setSelectedModelDraft(event.target.value)}
                  value={selectedModelDraft}
                >
                  {selectedProviderModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ai.settings.featuresTitle")}</CardTitle>
              <CardDescription>{t("ai.settings.featuresDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(
                [
                  ["projectAssistant", t("ai.settings.feature.projectAssistant")],
                  ["taskSuggestions", t("ai.settings.feature.taskSuggestions")],
                  ["riskAnalysis", t("ai.settings.feature.riskAnalysis")],
                  ["budgetForecast", t("ai.settings.feature.budgetForecast")],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)]/40 px-4 py-3 text-sm text-[var(--ink)]"
                >
                  <span>{label}</span>
                  <input
                    checked={featureDrafts[key]}
                    onChange={(event) =>
                      setFeatureDrafts((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ai.settings.usageTitle")}</CardTitle>
              <CardDescription>{t("ai.settings.usageDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)]/35 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {t("ai.settings.last24h")}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {usageSummary.last24Hours.requestCount}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {t("ai.settings.requestsLabel")} · ${usageSummary.last24Hours.costUsd.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)]/35 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {t("ai.settings.last7d")}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">
                    {usageSummary.last7Days.requestCount}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {t("ai.settings.requestsLabel")} · ${usageSummary.last7Days.costUsd.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                {usageSummary.providerBreakdown.length > 0 ? (
                  usageSummary.providerBreakdown.map((provider) => (
                    <div
                      key={provider.provider}
                      className="flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)]/35 px-4 py-3 text-sm"
                    >
                      <span className="font-medium text-[var(--ink)]">{provider.provider}</span>
                      <span className="text-[var(--ink-soft)]">
                        {provider.requestCount} · ${provider.costUsd.toFixed(2)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/20 p-4 text-sm text-[var(--ink-soft)]">
                    {t("ai.settings.usageEmpty")}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
