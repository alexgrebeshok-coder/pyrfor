"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Archive,
  Bot,
  BriefcaseBusiness,
  Calculator,
  Copy,
  Cpu,
  FileText,
  Folder,
  Layers3,
  Plug,
  Rocket,
  Search,
  Shield,
  Wrench,
} from "lucide-react";

import { useDashboard } from "@/components/dashboard-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/locale-context";
import {
  buildDocumentHubItems,
  buildDocumentHubTree,
  countByFolderPath,
  type DocumentHubFolderNode,
  type DocumentHubItem,
} from "@/lib/documents/catalog";
import { cn } from "@/lib/utils";

function getPathIcon(path: string) {
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

function sanitizeTestId(path: string) {
  return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getDocumentExtension(item: DocumentHubItem): string {
  const source = item.sourcePath || item.title;
  const match = source.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? "other";
}

function getDocumentTypeLabel(extension: string): string {
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

function DocumentsTreeNode({
  node,
  depth,
  items,
  selectedFolder,
  onSelectFolder,
}: {
  node: DocumentHubFolderNode;
  depth: number;
  items: DocumentHubItem[];
  selectedFolder: string;
  onSelectFolder: (folderPath: string) => void;
}) {
  const Icon = getPathIcon(node.folderPath);
  const count = countByFolderPath(items, node.folderPath);
  const active = selectedFolder === node.folderPath || selectedFolder.startsWith(`${node.folderPath}/`);
  const childCount = node.children?.length ?? 0;

  return (
    <div className="grid gap-1">
      <button
        type="button"
        data-testid={`documents-folder-${sanitizeTestId(node.folderPath)}`}
        onClick={() => onSelectFolder(node.folderPath)}
        className={cn(
          "grid w-full gap-1 overflow-hidden rounded-xl border text-left transition",
          depth === 0 ? "px-2.5 py-2" : "px-2.5 py-1.5",
          active
            ? "border-[var(--brand)] bg-[var(--brand)]/8"
            : "border-[var(--line)] bg-[var(--panel-soft)]/55 hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
        )}
        style={{ marginLeft: depth > 0 ? `${depth * 10}px` : 0 }}
      >
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              active ? "bg-[var(--brand)]/14 text-[var(--brand)]" : "bg-[var(--panel-soft-strong)] text-[var(--ink-soft)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-[var(--ink)]">{node.label}</span>
              <Badge variant={active ? "info" : "neutral"} className="px-1.5 py-0.5 text-[10px]">
                {count}
              </Badge>
            </div>
            {depth === 0 ? (
              <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-[var(--ink-soft)]">{node.description}</p>
            ) : (
              <p className="mt-1 text-[10px] leading-4 text-[var(--ink-muted)]">
                {childCount > 0 ? `${childCount} подветок` : "Ветка документов"}
              </p>
            )}
          </div>
        </div>
      </button>

      {node.children && node.children.length > 0 ? (
        <div className="space-y-1 border-l border-[var(--line)]/70 pl-2">
          {node.children.map((child) => (
            <DocumentsTreeNode
              key={child.id}
              depth={depth + 1}
              items={items}
              node={child}
              onSelectFolder={onSelectFolder}
              selectedFolder={selectedFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocumentsPage() {
  const { documents, projects } = useDashboard();
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [selectedFolder, setSelectedFolder] = useState<string>(() => {
    const folder = searchParams.get("folder");
    return folder && folder.length > 0 ? folder : "all";
  });
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const items = useMemo(() => buildDocumentHubItems(documents, projects), [documents, projects]);
  const tree = useMemo(() => buildDocumentHubTree(projects, items), [items, projects]);
  const fileTypes = useMemo(() => {
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
  }, [items]);

  const filteredItems = useMemo(() => {
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
  }, [items, query, selectedFolder, typeFilter]);

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? null);
    }
  }, [filteredItems, selectedId]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  const appCount = countByFolderPath(items, "application");
  const normativeCount = countByFolderPath(items, "normative");
  const projectCount = countByFolderPath(items, "project");
  const archiveCount = countByFolderPath(items, "archive");
  const folderFilters = [
    { key: "all", label: "Все", count: items.length },
    { key: "application", label: "Приложение", count: appCount },
    { key: "normative", label: "Нормативка", count: normativeCount },
    { key: "project", label: "Проекты", count: projectCount },
    { key: "archive", label: "Архив", count: archiveCount },
  ] as const;

  const copyPath = async (item: DocumentHubItem) => {
    try {
      await navigator.clipboard.writeText(item.sourcePath);
      setCopiedPath(item.id);
      window.setTimeout(() => setCopiedPath((current) => (current === item.id ? null : current)), 1600);
    } catch (error) {
      console.error("Failed to copy document path", error);
    }
  };

  return (
    <div className="grid gap-3" data-testid="documents-page">
      <Card className="p-3 lg:p-3">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="grid gap-2.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {t("page.documents.eyebrow")}
              </span>
              <h1 className="text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                {t("page.documents.title")}
              </h1>
              <p className="max-w-2xl text-xs leading-5 text-[var(--ink-soft)]">{t("page.documents.description")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{items.length} файлов</Badge>
              <Badge variant="info">{appCount} приложение</Badge>
              <Badge variant="warning">{normativeCount} нормативка</Badge>
              <Badge variant="success">{projectCount} проектные</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {folderFilters.map((filter) => {
                const active =
                  filter.key === "all"
                    ? selectedFolder === "all"
                    : selectedFolder === filter.key || selectedFolder.startsWith(`${filter.key}/`);
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setSelectedFolder(filter.key)}
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                        : "border-[var(--line)] bg-[var(--panel-soft)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    )}
                  >
                    <span>{filter.label}</span>
                    <span className="rounded-full bg-white/40 px-1.5 py-0.5 text-[10px]">
                      {filter.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {fileTypes.map((filter) => {
                const active = filter.key === typeFilter;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setTypeFilter(filter.key)}
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                        : "border-[var(--line)] bg-[var(--panel-soft)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    )}
                  >
                    <span>{filter.label}</span>
                    <span className="rounded-full bg-white/40 px-1.5 py-0.5 text-[10px]">
                      {filter.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/search">
              <Search className="h-4 w-4" />
              Глобальный поиск
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/help">
              <ArrowUpRight className="h-4 w-4" />
              Справка
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <Card className="p-3" data-testid="documents-tree">
          <div className="grid gap-2.5">
            <div className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Дерево папок
              </p>
              <p className="text-xs leading-5 text-[var(--ink-soft)]">
                Finder-подобная структура: папки видны сразу, а справа остаётся список файлов и предпросмотр.
              </p>
            </div>
            <div className="grid gap-2">
              {tree.map((node) => (
                <DocumentsTreeNode
                  key={node.id}
                  depth={0}
                  items={items}
                  node={node}
                  onSelectFolder={setSelectedFolder}
                  selectedFolder={selectedFolder}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-3" data-testid="documents-list">
          <div className="grid gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <Input
                aria-label="Поиск документов"
                className="h-10 pl-10"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти документ, папку или проект"
                value={query}
              />
            </div>

            <div className="grid gap-2">
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => {
                  const ItemIcon = getPathIcon(item.folderPath);
                  const active = item.id === selectedItem?.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      data-testid="documents-item"
                      className={cn(
                        "grid gap-1.5 rounded-xl border p-2 text-left transition",
                        active
                          ? "border-[var(--brand)] bg-[var(--brand)]/6 shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
                          : "border-[var(--line)] bg-[var(--panel-soft)]/60 hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--panel-soft-strong)] text-[var(--brand)]">
                          <ItemIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-[var(--ink)]">{item.title}</p>
                            <Badge variant="neutral" className="px-1.5 py-0.5 text-[10px]">
                              {item.updatedAt}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-[var(--ink-soft)]">
                            {item.summary}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="info">{item.folderLabel}</Badge>
                        <Badge variant="neutral">{getDocumentTypeLabel(getDocumentExtension(item))}</Badge>
                        {item.tags.slice(0, 2).map((tag) => (
                          <Badge key={`${item.id}-${tag}`} variant="neutral">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-3 text-center">
                  <p className="text-sm font-medium text-[var(--ink)]">Ничего не найдено</p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    Попробуйте другой запрос или переключите папку слева.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-3" data-testid="documents-preview">
          {selectedItem ? (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Просмотр
                </span>
                <h2 className="text-sm font-semibold tracking-[-0.03em] text-[var(--ink)]">
                  {selectedItem.title}
                </h2>
                <p className="text-xs leading-5 text-[var(--ink-soft)]">{selectedItem.summary}</p>
              </div>

              <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/70 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Источник</span>
                  <Badge variant="neutral" className="px-1.5 py-0.5 text-[10px]">
                    {selectedItem.updatedAt}
                  </Badge>
                </div>
                <p className="truncate text-xs text-[var(--ink)]" title={selectedItem.sourcePath}>
                  {selectedItem.sourcePath}
                </p>
                {selectedItem.projectName ? (
                  <p className="text-xs text-[var(--ink-soft)]">
                    Проект: {selectedItem.projectName}
                    {selectedItem.projectId ? ` · ${selectedItem.projectId}` : ""}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedItem.tags.map((tag) => (
                  <Badge key={`${selectedItem.id}-${tag}`} variant="neutral" className="px-1.5 py-0.5 text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>

              <div className="grid gap-2">
                {selectedItem.route ? (
                  <Link className={buttonVariants({ variant: "outline", size: "sm", className: "justify-start" })} href={selectedItem.route}>
                    <ArrowUpRight className="h-4 w-4" />
                    {selectedItem.projectId ? "Открыть проект" : "Открыть раздел"}
                  </Link>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => copyPath(selectedItem)}
                  className="justify-start"
                >
                  <Copy className="h-4 w-4" />
                  {copiedPath === selectedItem.id ? "Путь скопирован" : "Копировать путь"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--panel-soft)]/60 p-3 text-center">
              <p className="text-sm font-medium text-[var(--ink)]">Выберите документ</p>
              <p className="text-xs text-[var(--ink-soft)]">
                Здесь появится предпросмотр, путь и быстрые действия.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
