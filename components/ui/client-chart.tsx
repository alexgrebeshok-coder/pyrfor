"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ChartSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ClientChart({
  children,
  className,
}: {
  children: ReactNode | (() => ReactNode);
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className={cn("min-h-0 min-w-0", className)}>
      {mounted ? (typeof children === "function" ? children() : children) : <ChartSkeleton />}
    </div>
  );
}
