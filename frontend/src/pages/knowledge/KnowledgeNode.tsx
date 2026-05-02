import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BookOpenText, GitBranchPlus, Pencil, PlusCircle, Trash2 } from "lucide-react";

import { NodeCollapseToggle } from "@/components/graph/node-collapse-toggle";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { DIFFICULTY_COLORS, type Difficulty, type IKnowledgePointDetail } from "./types";

type KnowledgeNodeData = IKnowledgePointDetail & {
  onAddChild: (id: string) => void;
  onSetPrerequisite: (id: string) => void;
  onEdit: (id: string) => void;
  onViewResources: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  hasIncomingEdge?: boolean;
  hasOutgoingEdge?: boolean;
  hasChildren?: boolean;
  childCount?: number;
  collapsed?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  renameDraft?: string;
  onRenameDraftChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
};

export const KnowledgeNode = memo(({ data }: NodeProps) => {
  const kp = data as unknown as KnowledgeNodeData;
  const difficultyStyle = kp.difficulty ? DIFFICULTY_COLORS[kp.difficulty as Difficulty] : null;
  const isRootKnowledge = !kp.parent_id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`relative min-w-[116px] max-w-[256px] rounded-lg border px-2 py-1.5 pb-1 shadow-[0_4px_12px_rgba(120,113,108,0.1)] transition-colors duration-150 hover:bg-stone-100 focus-visible:bg-stone-100 dark:hover:bg-stone-800 dark:focus-visible:bg-stone-800 ${
            kp.isSelected
              ? "border-primary bg-primary/10 ring-1 ring-primary/20"
              : "border-stone-300/80 bg-stone-50 dark:border-stone-700 dark:bg-stone-900"
          }`}
        >
          {kp.hasChildren ? (
            <NodeCollapseToggle collapsed={Boolean(kp.collapsed)} count={kp.childCount} />
          ) : null}

          <Handle
            type="target"
            position={Position.Left}
            className={`!h-2.5 !w-2.5 !border !border-background !bg-primary transition-opacity ${
              kp.hasIncomingEdge ? "!opacity-100" : "!opacity-0"
            }`}
          />

          {kp.isEditing ? (
            <Input
              autoFocus
              className="h-6 px-1.5 text-[12px] font-semibold"
              onBlur={kp.onRenameSubmit}
              onChange={(event) => kp.onRenameDraftChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  kp.onRenameSubmit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  kp.onRenameCancel();
                }
              }}
              value={kp.renameDraft ?? ""}
            />
          ) : (
            <p
              className="truncate text-[12px] font-semibold leading-tight text-stone-900 dark:text-stone-100"
              style={{ maxWidth: "20em" }}
              title={kp.name}
            >
              {kp.name}
            </p>
          )}

          {kp.description && !isRootKnowledge && (
            <p className="mt-0.5 truncate text-[10px] text-stone-500/80 dark:text-stone-500/80">{kp.description}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {kp.tags?.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-stone-200 px-1 py-0.5 text-[8px] text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                {tag}
              </span>
            ))}
            {difficultyStyle && (
              <span className={`rounded-full px-1 py-0.5 text-[8px] ${difficultyStyle.bg} ${difficultyStyle.text}`}>
                {kp.difficulty}
              </span>
            )}
            {kp.question_count > 0 && (
              <span className="ml-auto text-[8px] text-stone-500 dark:text-stone-400">{kp.question_count}题</span>
            )}
          </div>

          <Handle
            type="source"
            position={Position.Right}
            className={`!h-2.5 !w-2.5 !border !border-background !bg-primary transition-opacity ${
              kp.hasOutgoingEdge ? "!opacity-100" : "!opacity-0"
            }`}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto min-w-0">
        <ContextMenuItem inset onSelect={() => kp.onAddChild(kp.id)}>
          <PlusCircle className="mr-2 h-3.5 w-3.5" />
          添加子知识
        </ContextMenuItem>
        <ContextMenuItem inset onSelect={() => kp.onSetPrerequisite(kp.id)}>
          <GitBranchPlus className="mr-2 h-3.5 w-3.5" />
          设置前置知识点
        </ContextMenuItem>
        <ContextMenuItem inset onSelect={() => kp.onEdit(kp.id)}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          编辑
        </ContextMenuItem>
        <ContextMenuItem inset onSelect={() => kp.onViewResources(kp.id)}>
          <BookOpenText className="mr-2 h-3.5 w-3.5" />
          查看关联资料
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" inset onSelect={() => kp.onDelete(kp.id, kp.name)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

KnowledgeNode.displayName = "KnowledgeNode";
