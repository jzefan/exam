import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, Layers3 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CourseKnowledgeNode } from "./api";

export type KnowledgeTreeMenuOption = {
  id: string;
  name: string;
  path: string;
  /** 仅用于调用方自述层级，菜单本身按 tree 递归展开，不依赖它。 */
  depth?: number;
};

function findAncestorIds(
  root: CourseKnowledgeNode | null,
  targetId: string | null,
): Set<string> {
  const ancestors = new Set<string>();
  if (!root || !targetId) return ancestors;

  const dfs = (node: CourseKnowledgeNode, path: string[]): boolean => {
    if (node.id === targetId) {
      for (const id of path) ancestors.add(id);
      return true;
    }
    for (const child of node.children ?? []) {
      if (dfs(child, [...path, node.id])) {
        return true;
      }
    }
    return false;
  };

  dfs(root, []);
  return ancestors;
}

function getInitialExpandedIds(
  root: CourseKnowledgeNode | null,
  showRoot: boolean,
  selectedId: string | null,
): Set<string> {
  if (!root) return new Set();
  const ids = new Set<string>();

  if (showRoot && root.id !== "__virtual_root__" && (root.children?.length ?? 0) > 0) {
    ids.add(root.id);
  }

  const topNodes =
    root.id === "__virtual_root__"
      ? (root.children ?? [])
      : showRoot
        ? []
        : (root.children ?? []);

  for (const node of topNodes) {
    if ((node.children?.length ?? 0) > 0) {
      ids.add(node.id);
    }
  }

  const ancestors = findAncestorIds(root, selectedId);
  for (const id of ancestors) {
    ids.add(id);
  }

  return ids;
}

/**
 * 知识点树选择菜单：课程目录按层级展示，可逐级展开 / 收起，首行是「全部知识点」。
 *
 * `showRootNode` 为 true 时（默认 false），会保留并展示课程根节点本身，便于用户直接选中整门课程或展开其子知识点。
 * `tree` 为空（调用方只拿到扁平选项）时退回按 `options` 平铺，不再造一层假层级。
 */
export function KnowledgeFilterTreeMenu({
  tree,
  options = [],
  selectedId,
  showRootNode = false,
  onSelect,
  onClose,
}: {
  tree: CourseKnowledgeNode | null;
  options?: KnowledgeTreeMenuOption[];
  selectedId: string | null;
  showRootNode?: boolean;
  onSelect: (nodeId: string | null) => void;
  onClose: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    getInitialExpandedIds(tree, showRootNode, selectedId),
  );

  useEffect(() => {
    setExpandedIds(getInitialExpandedIds(tree, showRootNode, selectedId));
  }, [tree?.id, showRootNode]);

  const availableIds = useMemo(
    () => (options && options.length > 0 ? new Set(options.map((option) => option.id)) : null),
    [options],
  );

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectNode = (nodeId: string | null) => {
    onSelect(nodeId);
    onClose();
  };

  const hasAvailableDescendant = (node: CourseKnowledgeNode): boolean => {
    if (!availableIds) return (node.children?.length ?? 0) > 0;
    return (node.children ?? []).some(
      (child) => availableIds.has(child.id) || hasAvailableDescendant(child),
    );
  };

  const renderNode = (
    node: CourseKnowledgeNode,
    depth: number,
  ): ReactNode => {
    const isAvailable = !availableIds || availableIds.has(node.id);
    const hasDescendants = hasAvailableDescendant(node);
    if (!isAvailable && !hasDescendants) return null;

    const hasChildren = (node.children?.length ?? 0) > 0 && hasDescendants;
    const expanded = expandedIds.has(node.id);
    const selected = node.id === selectedId;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center rounded-md text-sm transition-colors",
            selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
          )}
          style={{ paddingLeft: 8 }}
        >
          <button
            type="button"
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted-foreground/10",
              !hasChildren && "invisible",
            )}
            aria-label={expanded ? "收起知识点" : "展开知识点"}
            onClick={() => toggleExpanded(node.id)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left"
            title={options?.find((option) => option.id === node.id)?.path ?? node.name}
            onClick={() => selectNode(node.id)}
          >
            <BookOpen
              size={15}
              className={cn(
                "shrink-0",
                hasChildren ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {selected ? <Check size={14} className="shrink-0 text-primary" /> : null}
          </button>
        </div>
        {hasChildren && expanded ? (
          <div className="ml-4 border-l border-border/60 pl-2">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="max-h-[min(60vh,420px)] overflow-y-auto">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
          selectedId === null && "bg-primary/10 text-primary",
        )}
        onClick={() => selectNode(null)}
      >
        <Layers3 size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">全部知识点</span>
        {selectedId === null ? (
          <Check size={14} className="shrink-0 text-primary" />
        ) : null}
      </button>
      <div className="my-1 border-t border-border" />
      {tree ? (
        showRootNode && tree.id !== "__virtual_root__" ? (
          renderNode(tree, 0)
        ) : (tree.children?.length ?? 0) > 0 ? (
          tree.children.map((node) => renderNode(node, 0))
        ) : (
          renderNode(tree, 0)
        )
      ) : options && options.length > 0 ? (
        options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
              selectedId === option.id && "bg-primary/10 text-primary",
            )}
            onClick={() => selectNode(option.id)}
          >
            <BookOpen size={15} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            {selectedId === option.id ? (
              <Check size={14} className="shrink-0 text-primary" />
            ) : null}
          </button>
        ))
      ) : (
        <p className="px-2 py-2 text-xs text-muted-foreground">暂无知识点</p>
      )}
    </div>
  );
}
