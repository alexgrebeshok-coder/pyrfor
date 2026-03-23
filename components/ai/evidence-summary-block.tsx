"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AIConfidenceSummary, AIEvidenceFact } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

interface EvidenceSummaryBlockProps {
  facts?: AIEvidenceFact[] | null;
  confidence?: AIConfidenceSummary | null;
  className?: string;
  title?: string;
}

const confidenceTone = {
  low: "danger" as const,
  medium: "warning" as const,
  high: "info" as const,
  strong: "success" as const,
};

export function EvidenceSummaryBlock({
  facts,
  confidence,
  className,
  title = "Факты",
}: EvidenceSummaryBlockProps) {
  const visibleFacts = facts?.filter((fact) => fact.label.trim().length > 0 && fact.value.trim().length > 0) ?? [];

  if (visibleFacts.length === 0 && !confidence) {
    return null;
  }

  return (
    <div className={cn("mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          {title}
        </div>
        {confidence ? (
          <Badge variant={confidenceTone[confidence.band]}>
            {confidence.label} · {confidence.score}%
          </Badge>
        ) : null}
      </div>

      {confidence ? (
        <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">{confidence.rationale}</p>
      ) : null}

      {confidence?.basis.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {confidence.basis.map((basis) => (
            <span
              className="rounded-full bg-[var(--surface-panel)] px-2.5 py-1 text-[10px] font-medium text-[var(--ink-soft)]"
              key={basis}
            >
              {basis}
            </span>
          ))}
        </div>
      ) : null}

      {visibleFacts.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {visibleFacts.map((fact) =>
            fact.href ? (
              <Link
                className="group flex items-start justify-between gap-3 rounded-[12px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-3 py-2 transition hover:border-[var(--brand)]/35 hover:bg-[color:var(--surface-panel-strong)]"
                href={fact.href}
                key={`${fact.label}-${fact.value}`}
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    {fact.label}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--ink)]">{fact.value}</div>
                  {fact.meta ? (
                    <div className="mt-1 text-[11px] text-[var(--ink-soft)]">{fact.meta}</div>
                  ) : null}
                </div>
                <ArrowUpRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--ink-muted)] transition group-hover:text-[var(--brand)]" />
              </Link>
            ) : (
              <div
                className="rounded-[12px] border border-[var(--line)] bg-[color:var(--surface-panel)] px-3 py-2"
                key={`${fact.label}-${fact.value}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  {fact.label}
                </div>
                <div className="mt-1 text-sm leading-6 text-[var(--ink)]">{fact.value}</div>
                {fact.meta ? <div className="mt-1 text-[11px] text-[var(--ink-soft)]">{fact.meta}</div> : null}
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
