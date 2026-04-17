"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Copy, Search } from "lucide-react";

import { useDashboard } from "@/components/dashboard-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/locale-context";
import { buildDocumentHubItems, buildDocumentHubTree } from "@/lib/documents/catalog";
import { cn } from "@/lib/utils";

import { DocumentsTreeNode } from "./documents-tree-node";
import {
  buildFileTypeFilters,
  buildFolderFilters,
  filterDocumentItems,
  getDocumentExtension,
  getDocumentTypeLabel,
  getPathIcon,
} from "./documents-page.utils";

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
  const { counts: folderCounts, filters: folderFilters } = useMemo(
    () => buildFolderFilters(items),
    [items]
  );
  const fileTypes = useMemo(() => buildFileTypeFilters(items), [items]);
  const filteredItems = useMemo(
    () => filterDocumentItems(items, { query, selectedFolder, typeFilter }),
    [items, query, selectedFolder, typeFilter]
  );

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? null);
    }
  }, [filteredItems, selectedId]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  const copyPath = async (item: (typeof filteredItems)[number]) => {
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
          <div className="grid max-h-[calc(100vh-220px)] gap-2.5 overflow-y-auto pr-1">
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {t("page.documents.eyebrow")}
              </span>
              <h1 className="text-lg font-semibold tracking-[-0.04em] text-[var(--ink)]">
                {t("page.documents.title")}
              </h1>
              <p className="max-w-2xl text-xs leading-5 text-[var(--ink-soft)]">
                {t("page.documents.description")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{items.length} файлов</Badge>
              <Badge variant="info">{folderCounts.application} приложение</Badge>
              <Badge variant="warning">{folderCounts.normative} нормативка</Badge>
              <Badge variant="success">{folderCounts.project} проектные</Badge>
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
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                        : "border-[var(--line)] bg-[var(--panel-soft)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    )}
                    onClick={() => setSelectedFolder(filter.key)}
                    type="button"
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
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                        : "border-[var(--line)] bg-[var(--panel-soft)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    )}
                    onClick={() => setTypeFilter(filter.key)}
                    type="button"
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
                Finder-подобная структура: папки видны сразу, а справа остаётся список файлов и
                предпросмотр.
              </p>
            </div>
            <div className="grid gap-2">
              {tree.map((node) => (
                <DocumentsTreeNode
                  depth={0}
                  items={items}
                  key={node.id}
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
                      className={cn(
                        "grid gap-1.5 rounded-xl border p-2 text-left transition",
                        active
                          ? "border-[var(--brand)] bg-[var(--brand)]/6 shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
                          : "border-[var(--line)] bg-[var(--panel-soft)]/60 hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
                      )}
                      data-testid="documents-item"
                      onClick={() => setSelectedId(item.id)}
                      type="button"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--panel-soft-strong)] text-[var(--brand)]">
                          <ItemIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-[var(--ink)]">
                              {item.title}
                            </p>
                            <Badge className="px-1.5 py-0.5 text-[10px]" variant="neutral">
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
                        <Badge variant="neutral">
                          {getDocumentTypeLabel(getDocumentExtension(item))}
                        </Badge>
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
                  <span className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    Источник
                  </span>
                  <Badge className="px-1.5 py-0.5 text-[10px]" variant="neutral">
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
                  <Badge
                    key={`${selectedItem.id}-${tag}`}
                    className="px-1.5 py-0.5 text-[10px]"
                    variant="neutral"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>

              <div className="grid gap-2">
                {selectedItem.route ? (
                  <Link
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                      className: "justify-start",
                    })}
                    href={selectedItem.route}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    {selectedItem.projectId ? "Открыть проект" : "Открыть раздел"}
                  </Link>
                ) : null}
                <Button className="justify-start" onClick={() => void copyPath(selectedItem)} variant="outline">
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
