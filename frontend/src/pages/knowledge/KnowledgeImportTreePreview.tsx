import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  buildKnowledgeImportPreviewTree,
  type KnowledgeImportPath,
  type KnowledgeImportPreviewNode,
} from "./import-knowledge-utils";

type KnowledgeImportTreePreviewProps = {
  paths: KnowledgeImportPath[];
  emptyText: string;
  onRemoveNode?: (node: KnowledgeImportPreviewNode) => void;
  showTypeBadge?: boolean;
  showCounts?: boolean;
};

function TreeLevel({
  nodes,
  depth,
  onRemoveNode,
  showTypeBadge,
  showCounts,
}: {
  nodes: KnowledgeImportPreviewNode[];
  depth: number;
  onRemoveNode?: (node: KnowledgeImportPreviewNode) => void;
  showTypeBadge: boolean;
  showCounts: boolean;
}) {
  if (nodes.length === 0) return null;

  return (
    <div className={cn("flex flex-col", depth > 0 && "ml-3 border-l border-border/70 pl-3")}>
      {nodes.map((node) => {
        const isFolder = node.children.length > 0;
        const knowledgeTypeLabel = depth === 0 ? "主知识点" : "子知识点";

        return (
          <div key={`${depth}-${node.label}`} className="relative flex flex-col">
            <div className="group/item relative flex min-h-8 items-center gap-1.5 rounded-md py-0.5 transition-colors hover:bg-accent/40">
              {depth > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border/70"
                />
              )}

              {showTypeBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 rounded-sm px-1.5 py-0 text-[11px] font-medium",
                    depth === 0
                      ? "border-primary/25 bg-primary/10 text-primary"
                      : "border-border bg-muted/60 text-muted-foreground",
                  )}
                >
                  {knowledgeTypeLabel}
                </Badge>
              )}

              <div className="min-w-0 flex-1 rounded-md px-1.5 py-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "break-words text-[13px] font-medium leading-5 text-foreground transition-colors group-hover/item:text-foreground",
                        depth === 0 && "font-semibold",
                      )}
                    >
                      {node.label}
                    </p>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {showCounts && (
                      <p className="text-right text-[11px] text-muted-foreground">
                        {isFolder ? `${node.children.length} 个子项` : "无子项"}
                        {" · "}
                        覆盖 {node.pathIndexes.length} 条路径
                      </p>
                    )}

                    {onRemoveNode && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 rounded-md px-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveNode(node)}
                      >
                        <Trash2 className="size-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {isFolder && (
              <TreeLevel
                depth={depth + 1}
                nodes={node.children}
                onRemoveNode={onRemoveNode}
                showCounts={showCounts}
                showTypeBadge={showTypeBadge}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KnowledgeImportTreePreview({
  paths,
  emptyText,
  onRemoveNode,
  showTypeBadge = true,
  showCounts = true,
}: KnowledgeImportTreePreviewProps) {
  const tree = buildKnowledgeImportPreviewTree(paths);

  if (paths.length === 0) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{emptyText}</p>;
  }

  return (
    <TreeLevel
      depth={0}
      nodes={tree}
      onRemoveNode={onRemoveNode}
      showCounts={showCounts}
      showTypeBadge={showTypeBadge}
    />
  );
}
