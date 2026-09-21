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

/**
 * 知识点树选择菜单：课程目录按层级展示，可逐级展开 / 收起，首行是「全部知识点」。
 *
 * `tree` 为空（调用方只拿到扁平选项）时退回按 `options` 平铺，不再造一层假层级。
 */
export function KnowledgeFilterTreeMenu({
  tree,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  tree: CourseKnowledgeNode | null;
  options: KnowledgeTreeMenuOption[];
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onClose: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () =>
      new Set(
        (tree?.children ?? [])
          .filter((node) => node.children.length > 0)
          .map((node) => node.id),
      ),
  );

  useEffect(() => {
    setExpandedIds(
      new Set(
        (tree?.children ?? [])
          .filter((node) => node.children.length > 0)
          .map((node) => node.id),
      ),
    );
  }, [tree?.id]);

  const availableIds = useMemo(
    () => new Set(options.map((option) => option.id)),
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

  const renderNode = (
    node: CourseKnowledgeNode,
    depth: number,
  ): ReactNode => {
    if (!availableIds.has(node.id)) return null;
    const hasChildren = node.children.some((child) => availableIds.has(child.id));
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
            title={options.find((option) => option.id === node.id)?.path}
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
      {tree?.children.length ? (
        tree.children.map((node) => renderNode(node, 0))
      ) : options.length > 0 ? (
        options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
            onClick={() => selectNode(option.id)}
          >
            <BookOpen size={15} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-2 text-xs text-muted-foreground">暂无知识点</p>
      )}
    </div>
  );
}
