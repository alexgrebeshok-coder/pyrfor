"use client";

/**
 * Universal export button — dropdown for CSV/Excel/PDF export
 */

import { useState } from "react";


interface ExportButtonProps {
  entityType: "tasks" | "projects" | "risks";
  projectId?: string;
  className?: string;
}

const FORMATS = [
  { id: "csv", label: "CSV", icon: "📄" },
  { id: "xlsx", label: "Excel", icon: "📊" },
  { id: "pdf", label: "PDF", icon: "📕" },
] as const;

export function ExportButton({
  entityType,
  projectId,
  className,
}: ExportButtonProps) {
  
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: string) => {
    setExporting(true);
    setOpen(false);

    try {
      const params = new URLSearchParams({ format });
      if (projectId) params.set("projectId", projectId);

      const res = await fetch(
        `/api/${entityType}/export?${params.toString()}`
      );

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entityType}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`relative inline-block ${className || ""}`}>
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {exporting ? (
          <span className="animate-spin">⏳</span>
        ) : (
          <span>⬇️</span>
        )}
        Export
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-36 rounded-md border bg-popover shadow-lg">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => handleExport(f.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              >
                <span>{f.icon}</span>
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
