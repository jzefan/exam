import { useMemo, useState, type DragEvent } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  FolderTree,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatMajorName } from "@/lib/knowledge-display";
import { cn } from "@/lib/utils";
import type { IDirection, IKnowledgePointDetail, IMajor, IRootKnowledgePointOption } from "./types";

interface Props {
  majors: IMajor[];
  selectedDirectionId: string | null;
  selectedRootKnowledgeId: string | null;
  onSelect: (directionId: string) => void;
  onSelectRootKnowledge: (directionId: string, knowledgeId: string) => void;
  getDirections: (majorId: string) => IDirection[];
  getMajorRootKnowledgePoints: (majorId: string) => IRootKnowledgePointOption[];
  getRootKnowledgePoints: (directionId: string) => IKnowledgePointDetail[];
  onCreateMajor: () => void;
  onEditMajor: (major: IMajor) => void;
  onDeleteMajor: (major: IMajor) => void;
  onCreateDirection: (major: IMajor) => void;
  onCreateRootKnowledgeInMajor: (major: IMajor) => void;
  onCreateRootKnowledge: (direction: IDirection) => void;
  onEditDirection: (direction: IDirection) => void;
  onDeleteDirection: (direction: IDirection) => void;
  onEditRootKnowledge: (knowledge: IKnowledgePointDetail | IRootKnowledgePointOption) => void;
  onDeleteRootKnowledge: (knowledge: IKnowledgePointDetail | IRootKnowledgePointOption) => void;
  onMoveRootKnowledge: (
    source: IKnowledgePointDetail | IRootKnowledgePointOption,
    target: IKnowledgePointDetail | IRootKnowledgePointOption,
  ) => void;
  onSelectMajor: (major: IMajor) => void;
}

const DEFAULT_DIRECTION_NAMES = new Set(["通用", "默认方向"]);

const ROW_BASE =
  "group/row relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40";
const ROW_HOVER = "hover:bg-accent/60";
const ROW_SELECTED = "bg-primary/10 text-primary hover:bg-primary/15";
type SidebarViewMode = "major" | "direction";

function matchesQuery(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  return Boolean(text && text.toLowerCase().includes(query));
}

export function MajorDirectionSidebar({
  majors,
  selectedDirectionId,
  selectedRootKnowledgeId,
  onSelect,
  onSelectRootKnowledge,
  getDirections,
  getMajorRootKnowledgePoints,
  getRootKnowledgePoints,
  onCreateMajor,
  onEditMajor,
  onDeleteMajor,
  onCreateDirection,
  onCreateRootKnowledgeInMajor,
  onCreateRootKnowledge,
  onEditDirection,
  onDeleteDirection,
  onEditRootKnowledge,
  onDeleteRootKnowledge,
  onMoveRootKnowledge,
  onSelectMajor,
}: Props) {
  const [expandedMajorIds, setExpandedMajorIds] = useState<Set<string>>(
    () => new Set(majors[0]?.id ? [majors[0].id] : []),
  );
  const [viewMode, setViewMode] = useState<SidebarViewMode>("major");
  const [query, setQuery] = useState("");
  const [draggingRootKnowledgeId, setDraggingRootKnowledgeId] = useState<string | null>(null);
  const [dropTargetRootKnowledgeId, setDropTargetRootKnowledgeId] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const isDirectionMode = viewMode === "direction";
  const switchLabel = isDirectionMode ? "切换为专业/主知识" : "切换为专业/方向/主知识";

  const selectedMajorId = useMemo(() => {
    if (!selectedDirectionId && !selectedRootKnowledgeId) return null;
    for (const major of majors) {
      if (getMajorRootKnowledgePoints(major.id).some((k) => k.id === selectedRootKnowledgeId)) {
        return major.id;
      }
      if (getDirections(major.id).some((d) => d.id === selectedDirectionId)) {
        return major.id;
      }
    }
    return null;
  }, [getDirections, getMajorRootKnowledgePoints, majors, selectedDirectionId, selectedRootKnowledgeId]);

  const majorRootKnowledgeById = useMemo(() => {
    const map = new Map<string, IRootKnowledgePointOption>();
    for (const major of majors) {
      for (const knowledge of getMajorRootKnowledgePoints(major.id)) {
        map.set(knowledge.id, knowledge);
      }
    }
    return map;
  }, [getMajorRootKnowledgePoints, majors]);

  const rootKnowledgeById = useMemo(() => {
    const map = new Map<string, IKnowledgePointDetail>();
    for (const major of majors) {
      for (const direction of getDirections(major.id)) {
        for (const knowledge of getRootKnowledgePoints(direction.id)) {
          map.set(knowledge.id, knowledge);
        }
      }
    }
    return map;
  }, [getDirections, getRootKnowledgePoints, majors]);

  const visibleMajors = useMemo(() => {
    if (!normalizedQuery) return majors;
    return majors.filter((major) => {
      if (matchesQuery(major.name, normalizedQuery) || matchesQuery(formatMajorName(major.name), normalizedQuery)) return true;
      if (getMajorRootKnowledgePoints(major.id).some((k) => matchesQuery(k.name, normalizedQuery))) return true;
      if (getDirections(major.id).some((d) => matchesQuery(d.name, normalizedQuery))) return true;
      return false;
    });
  }, [majors, normalizedQuery, getDirections, getMajorRootKnowledgePoints]);

  const isMajorExpanded = (id: string) =>
    expandedMajorIds.has(id) || (Boolean(normalizedQuery) && visibleMajors.some((m) => m.id === id)) || id === selectedMajorId;

  const toggleMajor = (id: string) => {
    setExpandedMajorIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRootKnowledgeDrop = (
    event: DragEvent,
    target: IKnowledgePointDetail | IRootKnowledgePointOption,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData("application/x-knowledge-root-id") || draggingRootKnowledgeId;
    setDropTargetRootKnowledgeId(null);
    setDraggingRootKnowledgeId(null);
    if (!sourceId || sourceId === target.id) {
      return;
    }
    const source =
      rootKnowledgeById.get(sourceId) ??
      majorRootKnowledgeById.get(sourceId);
    if (!source) {
      return;
    }
    onMoveRootKnowledge(source, target);
  };

  return (
    <aside className="flex w-[260px] flex-shrink-0 flex-col overflow-hidden border-r border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {isDirectionMode ? "专业 / 方向 / 主知识" : "专业 / 主知识"}
        </p>
        <div className="flex items-center gap-1">
          <Button
            aria-label={switchLabel}
            className="h-6 w-6 rounded-md p-0"
            onClick={() => setViewMode(isDirectionMode ? "major" : "direction")}
            size="icon"
            title={switchLabel}
            type="button"
            variant="ghost"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            aria-label="添加专业"
            className="h-6 w-6 rounded-md p-0"
            onClick={onCreateMajor}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索专业、方向或知识点"
            className="h-8 pl-7 pr-7 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索专业、方向或知识点"
            value={query}
          />
          {query && (
            <button
              aria-label="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setQuery("")}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {visibleMajors.map((major) => {
            const expanded = isMajorExpanded(major.id);
            const directions = getDirections(major.id);
            const majorRoots = getMajorRootKnowledgePoints(major.id);

            const filteredRoots = normalizedQuery
              ? majorRoots.filter(
                  (k) =>
                    matchesQuery(k.name, normalizedQuery) ||
                    matchesQuery(major.name, normalizedQuery) ||
                    matchesQuery(formatMajorName(major.name), normalizedQuery),
                )
              : majorRoots;

            const filteredDirections = normalizedQuery
              ? directions.filter(
                  (d) =>
                    matchesQuery(d.name, normalizedQuery) ||
                    matchesQuery(major.name, normalizedQuery) ||
                    matchesQuery(formatMajorName(major.name), normalizedQuery) ||
                    getRootKnowledgePoints(d.id).some((k) => matchesQuery(k.name, normalizedQuery)),
                )
              : directions;

            return (
              <div key={major.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className={cn(ROW_BASE, ROW_HOVER)}>
                      <button
                        aria-expanded={expanded}
                        className="-mx-2 flex min-w-0 flex-1 items-center gap-1.5 truncate px-2 py-0.5 text-left focus:outline-none"
                        onClick={() => {
                          onSelectMajor(major);
                          toggleMajor(major.id);
                        }}
                        type="button"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {formatMajorName(major.name)}
                        </span>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label="更多操作"
                            className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
                            onClick={(event) => event.stopPropagation()}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => onCreateRootKnowledgeInMajor(major)}>
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            新增主知识/技能
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => onEditMajor(major)}>编辑专业</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onDeleteMajor(major)}
                          >
                            删除专业
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onSelect={() => onCreateRootKnowledgeInMajor(major)}>
                      新增主知识/技能
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onEditMajor(major)}>编辑专业</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDeleteMajor(major)}
                    >
                      删除专业
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                {expanded && (
                  <div className="mt-0.5 ml-2 border-l border-border/70 pl-2">
                    {!isDirectionMode && filteredRoots.map((knowledge) => {
                      const isSelected = selectedRootKnowledgeId === knowledge.id;
                      const showDirectionName =
                        knowledge.direction_name && !DEFAULT_DIRECTION_NAMES.has(knowledge.direction_name);

                      return (
                        <ContextMenu key={knowledge.id}>
                          <ContextMenuTrigger asChild>
                            <button
                              className={cn(
                                ROW_BASE,
                                isSelected ? ROW_SELECTED : cn(ROW_HOVER, "text-foreground/80"),
                                draggingRootKnowledgeId === knowledge.id && "opacity-50",
                                dropTargetRootKnowledgeId === knowledge.id &&
                                  draggingRootKnowledgeId !== knowledge.id &&
                                  "bg-primary/10 ring-1 ring-primary/40",
                              )}
                              draggable
                              onDragEnd={() => {
                                setDraggingRootKnowledgeId(null);
                                setDropTargetRootKnowledgeId(null);
                              }}
                              onDragOver={(event) => {
                                if (draggingRootKnowledgeId && draggingRootKnowledgeId !== knowledge.id) {
                                  event.preventDefault();
                                  setDropTargetRootKnowledgeId(knowledge.id);
                                }
                              }}
                              onDragLeave={() => {
                                if (dropTargetRootKnowledgeId === knowledge.id) {
                                  setDropTargetRootKnowledgeId(null);
                                }
                              }}
                              onDragStart={(event) => {
                                setDraggingRootKnowledgeId(knowledge.id);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("application/x-knowledge-root-id", knowledge.id);
                                event.dataTransfer.setData("text/plain", knowledge.name);
                              }}
                              onDrop={(event) => handleRootKnowledgeDrop(event, knowledge)}
                              onClick={() => onSelectRootKnowledge(knowledge.direction_id, knowledge.id)}
                              type="button"
                            >
                              <span
                                className={cn(
                                  "ml-1 h-1 w-1 shrink-0 rounded-full",
                                  isSelected ? "bg-primary" : "bg-muted-foreground/40",
                                )}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs leading-tight">{knowledge.name}</span>
                                {showDirectionName && (
                                  <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                                    {knowledge.direction_name}
                                  </span>
                                )}
                              </span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <span
                                    aria-label="更多操作"
                                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-accent group-hover/row:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
                                    onClick={(event) => event.stopPropagation()}
                                    role="button"
                                  >
                                    <MoreHorizontal className="h-3 w-3" />
                                  </span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onSelect={() => onEditRootKnowledge(knowledge)}>
                                    编辑
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => onDeleteRootKnowledge(knowledge)}
                                  >
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-44">
                            <ContextMenuItem onSelect={() => onEditRootKnowledge(knowledge)}>编辑</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => onDeleteRootKnowledge(knowledge)}
                            >
                              删除
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}

                    {!isDirectionMode && filteredRoots.length === 0 && !normalizedQuery && (
                      <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">暂无主知识/技能</p>
                    )}

                    {!isDirectionMode && (
                      <button
                        className="mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                        onClick={() => onCreateRootKnowledgeInMajor(major)}
                        type="button"
                      >
                        <Plus className="h-3 w-3" />
                        添加主知识/技能
                      </button>
                    )}

                    {isDirectionMode &&
                      filteredDirections.map((direction) => {
                        const isSelectedDirection = selectedDirectionId === direction.id && !selectedRootKnowledgeId;
                        const directionKnowledge = getRootKnowledgePoints(direction.id);

                        return (
                          <ContextMenu key={direction.id}>
                            <ContextMenuTrigger asChild>
                              <div>
                                <button
                                  className={cn(
                                    ROW_BASE,
                                    "mt-0.5",
                                    isSelectedDirection ? ROW_SELECTED : cn(ROW_HOVER, "text-foreground/70"),
                                  )}
                                  onClick={() => onSelect(direction.id)}
                                  type="button"
                                >
                                  <FolderTree
                                    className={cn(
                                      "h-3.5 w-3.5 shrink-0",
                                      isSelectedDirection ? "text-primary" : "text-muted-foreground/70",
                                    )}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-xs">{direction.name}</span>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <span
                                        aria-label="更多操作"
                                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-accent group-hover/row:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
                                        onClick={(event) => event.stopPropagation()}
                                        role="button"
                                      >
                                        <MoreHorizontal className="h-3 w-3" />
                                      </span>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-44">
                                      <DropdownMenuItem onSelect={() => onCreateRootKnowledge(direction)}>
                                        <Plus className="mr-2 h-3.5 w-3.5" />
                                        新增主知识/技能
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onSelect={() => onEditDirection(direction)}>
                                        编辑方向
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => onDeleteDirection(direction)}
                                      >
                                        删除方向
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </button>

                                {isSelectedDirection && (
                                  <div className="ml-2 mt-0.5 border-l border-border/70 pl-2">
                                    {directionKnowledge.map((knowledge) => {
                                      const isKSelected = selectedRootKnowledgeId === knowledge.id;
                                      return (
                                        <ContextMenu key={knowledge.id}>
                                          <ContextMenuTrigger asChild>
                                            <button
                                              className={cn(
                                                ROW_BASE,
                                                isKSelected
                                                  ? ROW_SELECTED
                                                  : cn(ROW_HOVER, "text-foreground/75"),
                                                draggingRootKnowledgeId === knowledge.id && "opacity-50",
                                                dropTargetRootKnowledgeId === knowledge.id &&
                                                  draggingRootKnowledgeId !== knowledge.id &&
                                                  "bg-primary/10 ring-1 ring-primary/40",
                                              )}
                                              draggable
                                              onDragEnd={() => {
                                                setDraggingRootKnowledgeId(null);
                                                setDropTargetRootKnowledgeId(null);
                                              }}
                                              onDragOver={(event) => {
                                                if (draggingRootKnowledgeId && draggingRootKnowledgeId !== knowledge.id) {
                                                  event.preventDefault();
                                                  setDropTargetRootKnowledgeId(knowledge.id);
                                                }
                                              }}
                                              onDragLeave={() => {
                                                if (dropTargetRootKnowledgeId === knowledge.id) {
                                                  setDropTargetRootKnowledgeId(null);
                                                }
                                              }}
                                              onDragStart={(event) => {
                                                setDraggingRootKnowledgeId(knowledge.id);
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("application/x-knowledge-root-id", knowledge.id);
                                                event.dataTransfer.setData("text/plain", knowledge.name);
                                              }}
                                              onDrop={(event) => handleRootKnowledgeDrop(event, knowledge)}
                                              onClick={() =>
                                                onSelectRootKnowledge(direction.id, knowledge.id)
                                              }
                                              type="button"
                                            >
                                              <span
                                                className={cn(
                                                  "ml-1 h-1 w-1 shrink-0 rounded-full",
                                                  isKSelected ? "bg-primary" : "bg-muted-foreground/40",
                                                )}
                                              />
                                              <span className="min-w-0 flex-1 truncate text-xs">
                                                {knowledge.name}
                                              </span>
                                            </button>
                                          </ContextMenuTrigger>
                                          <ContextMenuContent className="w-44">
                                            <ContextMenuItem onSelect={() => onEditRootKnowledge(knowledge)}>
                                              编辑
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem
                                              className="text-destructive focus:text-destructive"
                                              onSelect={() => onDeleteRootKnowledge(knowledge)}
                                            >
                                              删除
                                            </ContextMenuItem>
                                          </ContextMenuContent>
                                        </ContextMenu>
                                      );
                                    })}
                                    <button
                                      className="mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                                      onClick={() => onCreateRootKnowledge(direction)}
                                      type="button"
                                    >
                                      <Plus className="h-3 w-3" />
                                      添加主知识/技能
                                    </button>
                                  </div>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-44">
                              <ContextMenuItem onSelect={() => onCreateRootKnowledge(direction)}>
                                新增主知识/技能
                              </ContextMenuItem>
                              <ContextMenuItem onSelect={() => onEditDirection(direction)}>编辑方向</ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => onDeleteDirection(direction)}
                              >
                                删除方向
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}

                    {isDirectionMode && filteredDirections.length === 0 && !normalizedQuery && (
                      <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">暂无方向</p>
                    )}

                    {isDirectionMode && (
                      <button
                        className="mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                        onClick={() => onCreateDirection(major)}
                        type="button"
                      >
                        <Plus className="h-3 w-3" />
                        添加方向
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {visibleMajors.length === 0 && (
            <div className="px-3 py-8 text-center">
              {normalizedQuery ? (
                <p className="text-xs text-muted-foreground">未找到匹配的内容</p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">暂无专业</p>
                  <Button onClick={onCreateMajor} size="sm" type="button" variant="outline">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    创建第一个专业
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
