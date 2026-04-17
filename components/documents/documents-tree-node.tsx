import { Badge } from "@/components/ui/badge";
import {
  countByFolderPath,
  type DocumentHubFolderNode,
  type DocumentHubItem,
} from "@/lib/documents/catalog";
import { cn } from "@/lib/utils";

import { getPathIcon, sanitizeTestId } from "./documents-page.utils";

export function DocumentsTreeNode({
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
  const active =
    selectedFolder === node.folderPath || selectedFolder.startsWith(`${node.folderPath}/`);
  const childCount = node.children?.length ?? 0;

  return (
    <div className="grid gap-1">
      <button
        className={cn(
          "grid w-full gap-1 overflow-hidden rounded-xl border text-left transition",
          depth === 0 ? "px-2.5 py-2" : "px-2.5 py-1.5",
          active
            ? "border-[var(--brand)] bg-[var(--brand)]/8"
            : "border-[var(--line)] bg-[var(--panel-soft)]/55 hover:border-[var(--line-strong)] hover:bg-[var(--surface-panel)]"
        )}
        data-testid={`documents-folder-${sanitizeTestId(node.folderPath)}`}
        onClick={() => onSelectFolder(node.folderPath)}
        style={{ marginLeft: depth > 0 ? `${depth * 10}px` : 0 }}
        type="button"
      >
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              active
                ? "bg-[var(--brand)]/14 text-[var(--brand)]"
                : "bg-[var(--panel-soft-strong)] text-[var(--ink-soft)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-[var(--ink)]">{node.label}</span>
              <Badge className="px-1.5 py-0.5 text-[10px]" variant={active ? "info" : "neutral"}>
                {count}
              </Badge>
            </div>
            {depth === 0 ? (
              <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-[var(--ink-soft)]">
                {node.description}
              </p>
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
              depth={depth + 1}
              items={items}
              key={child.id}
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
