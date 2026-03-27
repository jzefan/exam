import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { IDirection, IMajor } from "./types";

interface Props {
  majors: IMajor[];
  selectedDirectionId: string | null;
  onSelect: (directionId: string) => void;
  getDirections: (majorId: string) => IDirection[];
  onCreateMajor: () => void;
  onEditMajor: (major: IMajor) => void;
  onDeleteMajor: (major: IMajor) => void;
  onCreateDirection: (major: IMajor) => void;
  onEditDirection: (direction: IDirection) => void;
  onDeleteDirection: (direction: IDirection) => void;
}

export function MajorDirectionSidebar({
  majors,
  selectedDirectionId,
  onSelect,
  getDirections,
  onCreateMajor,
  onEditMajor,
  onDeleteMajor,
  onCreateDirection,
  onEditDirection,
  onDeleteDirection,
}: Props) {
  const [expandedMajors, setExpandedMajors] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedMajors(new Set(majors.map((major) => major.id)));
  }, [majors]);

  const toggleMajor = (id: string) =>
    setExpandedMajors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <TooltipProvider delayDuration={120}>
      <aside className="w-[260px] flex-shrink-0 overflow-y-auto border-r border-stone-200/80 bg-[linear-gradient(180deg,rgba(245,245,244,0.8),rgba(245,245,244,0.55))] px-2 py-2 dark:border-stone-800 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.72),rgba(17,24,39,0.42))]">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">
          专业 / 方向
        </p>
        <Button
          className="h-7 rounded-full px-2.5 text-[11px]"
          size="sm"
          onClick={onCreateMajor}
          type="button"
        >
          + 专业
        </Button>
      </div>
      <div className="space-y-2">
        {majors.map((major) => {
          const expanded = expandedMajors.has(major.id);
          const directions = getDirections(major.id);
          return (
            <ContextMenu key={major.id}>
              <ContextMenuTrigger asChild>
                <div className="relative rounded-xl border border-stone-200/80 bg-white/75 p-1.5 shadow-[0_8px_20px_rgba(120,113,108,0.08)] dark:border-stone-800 dark:bg-stone-950/40">
                  <div className="group/major relative">
                    <div className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-stone-200/60 dark:hover:bg-stone-900/70">
                      <Button
                        className="h-10 flex min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-left text-[13px] font-medium text-stone-800 dark:text-stone-200"
                        onClick={() => toggleMajor(major.id)}
                        type="button"
                        variant="ghost"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" />
                        )}
                        <span className="truncate">{major.name}</span>
                      </Button>
                      <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-stone-200/80 bg-white/92 px-0.5 py-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/major:opacity-100 focus-within:opacity-100 dark:border-stone-700 dark:bg-stone-950/85">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-6 w-6 rounded-sm p-0 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                              size="icon"
                              variant="ghost"
                              onClick={() => onCreateDirection(major)}
                              type="button"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>新增方向</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-6 w-6 rounded-sm p-0 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                              size="icon"
                              variant="ghost"
                              onClick={() => onEditMajor(major)}
                              type="button"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>修改专业</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="h-6 w-6 rounded-sm p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                              size="icon"
                              variant="ghost"
                              onClick={() => onDeleteMajor(major)}
                              type="button"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>删除专业</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-0.5 space-y-0.5 pl-7">
                      {directions.map((direction) => (
                        <ContextMenu key={direction.id}>
                          <ContextMenuTrigger asChild>
                            <div className="group/direction relative flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-stone-200/50 dark:hover:bg-stone-900/60">
                              <Button
                                className={`h-9 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 pr-8 text-left text-[12px] ${
                                  selectedDirectionId === direction.id
                                    ? "bg-amber-100/80 text-amber-900 dark:bg-amber-900/35 dark:text-amber-200"
                                    : "text-stone-600 dark:text-stone-400"
                                }`}
                                onClick={() => onSelect(direction.id)}
                                type="button"
                                variant="ghost"
                              >
                                <span className="truncate">{direction.name}</span>
                              </Button>
                              <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-stone-200/80 bg-white/92 px-0.5 py-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/direction:opacity-100 focus-within:opacity-100 dark:border-stone-700 dark:bg-stone-950/85">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      className="h-6 w-6 rounded-sm p-0 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => onEditDirection(direction)}
                                      type="button"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>修改方向</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      className="h-6 w-6 rounded-sm p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => onDeleteDirection(direction)}
                                      type="button"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>删除方向</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-auto min-w-0">
                            <ContextMenuItem inset onSelect={() => onEditDirection(direction)}>
                              编辑方向
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              inset
                              onSelect={() => onDeleteDirection(direction)}
                            >
                              删除方向
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                      {directions.length === 0 && (
                        <p className="px-2 py-2 text-[11px] text-stone-400 dark:text-stone-500">暂无方向</p>
                      )}
                    </div>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-auto min-w-0">
                <ContextMenuItem inset onSelect={() => toggleMajor(major.id)}>
                  {expanded ? "收起专业" : "展开专业"}
                </ContextMenuItem>
                <ContextMenuItem inset onSelect={() => onCreateDirection(major)}>
                  新增方向
                </ContextMenuItem>
                <ContextMenuItem inset onSelect={() => onEditMajor(major)}>
                  编辑专业
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  inset
                  onSelect={() => onDeleteMajor(major)}
                >
                  删除专业
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {majors.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-stone-400 dark:text-stone-500">暂无专业，先创建一个专业</p>
        )}
      </div>
      </aside>
    </TooltipProvider>
  );
}
