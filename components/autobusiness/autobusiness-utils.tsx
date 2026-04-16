"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { useLocale } from "@/contexts/locale-context";
import type { KpiTrend } from "@/lib/autobusiness/demo-data";
import { formatCurrency } from "@/lib/utils";

const localeMap = {
  ru: "ru-RU",
  en: "en-US",
  zh: "zh-CN",
} as const;

export function getTrendVariant(trend: KpiTrend): "success" | "danger" | "neutral" {
  switch (trend) {
    case "up":
      return "success";
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

export function getTrendIcon(trend: KpiTrend): LucideIcon {
  switch (trend) {
    case "up":
      return ArrowUpRight;
    case "down":
      return ArrowDownRight;
    default:
      return Minus;
  }
}

export function useAutobusinessFormatting() {
  const { locale, t } = useLocale();
  const numberLocale = localeMap[locale] ?? "ru-RU";

  const millionFormatter = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [numberLocale]
  );

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [numberLocale]
  );

  const monthFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(numberLocale, {
        month: "short",
      }),
    [numberLocale]
  );

  const formatMillions = (value: number) => `${millionFormatter.format(value)} ${t("autobusiness.unit")}`;

  const formatSignedMillions = (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "-" : ""}${millionFormatter.format(Math.abs(value))} ${t("autobusiness.unit")}`;

  const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;

  const formatFullRubles = (value: number) => formatCurrency(value * 1_000_000, "RUB", locale);

  const normalizeKpiValue = (value: string) => {
    if (value.includes("млрд")) {
      const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
      const signedValue = value.trim().startsWith("-") ? -parsed * 1000 : parsed * 1000;
      const prefix = value.trim().startsWith("+") ? "+" : signedValue < 0 ? "-" : "";

      return {
        displayValue: `${prefix}${millionFormatter.format(Math.abs(signedValue))}`,
        unit: t("autobusiness.unit"),
        title: formatCurrency(signedValue * 1_000_000, "RUB", locale),
      };
    }

    if (value.includes("%")) {
      const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
      const prefix = value.trim().startsWith("+") ? "+" : value.trim().startsWith("-") ? "-" : "";

      return {
        displayValue: `${prefix}${percentFormatter.format(Math.abs(parsed))}%`,
        unit: "",
      };
    }

    return {
      displayValue: value,
      unit: "",
    };
  };

  const formatMonth = (month: number) => {
    const value = monthFormatter.format(new Date(Date.UTC(2025, month - 1, 1)));
    return value.endsWith(".") ? value.slice(0, -1) : value;
  };

  return {
    t,
    formatFullRubles,
    formatMillions,
    formatMonth,
    formatPercent,
    formatSignedMillions,
    normalizeKpiValue,
  };
}
