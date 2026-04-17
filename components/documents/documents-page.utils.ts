import {
  Archive,
  Bot,
  BriefcaseBusiness,
  Calculator,
  Cpu,
  FileText,
  Folder,
  Layers3,
  Plug,
  Rocket,
  Shield,
  Wrench,
} from "lucide-react";

import { countByFolderPath, type DocumentHubItem } from "@/lib/documents/catalog";

export function getPathIcon(path: string) {
  switch (path) {
    case "application":
      return FileText;
    case "application/launch":
      return Rocket;
    case "application/ai":
      return Bot;
    case "application/tools":
      return Wrench;
    case "application/integrations":
      return Plug;
    case "normative":
      return Shield;
    case "normative/architecture":
      return Layers3;
    case "normative/providers":
      return Cpu;
    case "normative/finance":
      return Calculator;
    case "project":
      return BriefcaseBusiness;
    case "archive":
      return Archive;
    default:
      return Folder;
  }
}

export function sanitizeTestId(path: string) {
  return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function getDocumentExtension(item: DocumentHubItem): string {
  const source = item.sourcePath || item.title;
  const match = source.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? "other";
}

export function getDocumentTypeLabel(extension: string): string {
  switch (extension) {
    case "md":
      return "Markdown";
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "xlsx":
      return "XLSX";
    case "py":
      return "Python";
    case "json":
      return "JSON";
    default:
      return "Файл";
  }
}

export function buildFileTypeFilters(items: DocumentHubItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const ext = getDocumentExtension(item);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }

  return [
    { key: "all", label: "Все типы", count: items.length },
    ...Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right, "ru"))
      .map(([key, count]) => ({
        key,
        label: getDocumentTypeLabel(key),
        count,
      })),
  ];
}

export function filterDocumentItems(
  items: DocumentHubItem[],
  {
    query,
    selectedFolder,
    typeFilter,
  }: {
    query: string;
    selectedFolder: string;
    typeFilter: string;
  }
) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedFolder = selectedFolder === "all" ? null : selectedFolder;
  const normalizedType = typeFilter === "all" ? null : typeFilter;

  return items
    .filter((item) =>
      normalizedFolder
        ? item.folderPath === normalizedFolder || item.folderPath.startsWith(`${normalizedFolder}/`)
        : true
    )
    .filter((item) => (normalizedType ? getDocumentExtension(item) === normalizedType : true))
    .filter((item) =>
      normalizedQuery.length === 0
        ? true
        : [item.title, item.summary, item.sourcePath, item.projectName ?? "", item.tags.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery)
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function buildFolderFilters(items: DocumentHubItem[]) {
  const counts = {
    all: items.length,
    application: countByFolderPath(items, "application"),
    normative: countByFolderPath(items, "normative"),
    project: countByFolderPath(items, "project"),
    archive: countByFolderPath(items, "archive"),
  };

  return {
    counts,
    filters: [
      { key: "all", label: "Все", count: counts.all },
      { key: "application", label: "Приложение", count: counts.application },
      { key: "normative", label: "Нормативка", count: counts.normative },
      { key: "project", label: "Проекты", count: counts.project },
      { key: "archive", label: "Архив", count: counts.archive },
    ] as const,
  };
}
