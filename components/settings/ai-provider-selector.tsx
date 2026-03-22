"use client";

import { Button } from "@/components/ui/button";
import { useAIWorkspace } from "@/contexts/ai-context";
import { useLocale } from "@/contexts/locale-context";
import type { AIWorkspaceMode } from "@/lib/ai/types";
import type { MessageKey } from "@/lib/translations";
import { cn } from "@/lib/utils";

const items: Array<{ mode: AIWorkspaceMode; labelKey: MessageKey }> = [
  { mode: "auto", labelKey: "settings.mode.auto" },
  { mode: "mock", labelKey: "settings.mode.mock" },
  { mode: "local", labelKey: "settings.mode.local" },
  { mode: "gateway", labelKey: "settings.mode.gateway" },
];

export function AIProviderSelector() {
  const { preferredMode, setPreferredMode } = useAIWorkspace();
  const { t } = useLocale();

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.mode === preferredMode;
        return (
          <Button
            className={cn("rounded-2xl", active && "shadow-[0_12px_28px_rgba(15,23,42,.1)]")}
            key={item.mode}
            onClick={() => setPreferredMode(item.mode)}
            variant={active ? "secondary" : "outline"}
          >
            {t(item.labelKey)}
          </Button>
        );
      })}
    </div>
  );
}
