"use client";

import { useEffect } from "react";

import { ErrorFallbackCard } from "@/components/error-fallback-card";

export default function KanbanError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kanban page error:", error);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorFallbackCard
        error={error}
        onReload={() => window.location.reload()}
        onRetry={reset}
      />
    </div>
  );
}
