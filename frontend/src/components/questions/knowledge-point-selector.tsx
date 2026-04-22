import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, File, Loader2, Search, Star, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildKnowledgeTreeVisibility,
  buildRecentKeywordState,
  getTopRecentKeywords,
  type RecentKeywordState,
} from "@/pages/questions/ai-generate-utils";
import { cn } from "@/lib/utils";

export type SelectedKnowledgePoint = {
  id: string;
  name: string;
  path: string;
};

export type KnowledgePointSelectorFetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

type KnowledgeMajor = {
  id: string;
  name: string;
};

type KnowledgeDirection = {
  id: string;
  major_id: string;
  name: string;
};

type KnowledgeTreeNode = {
  id: string;
  name: string;
  parent_id: string | null;
  direction_id: string | null;
};

type FrequentKnowledgePointItem = {
  id: string;
  name: string;
  path: string;
  use_count: number;
  last_used_at: string;
};

function KnowledgeIcon({ className }: { className?: string }) {
  return <img src="/knowledge.svg" alt="" className={className} aria-hidden="true" />;
}

function KnowledgeTreeRow({
  label,
  expanded,
  hasChildren,
  selected = false,
  selectable = true,
  onExpand,
  onClick,
  icon,
  tag,
}: {
  label: string;
  expanded?: boolean;
  hasChildren?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onExpand?: () => void;
  onClick?: () => void;
  icon: React.ReactNode;
  tag?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center rounded-md px-2 py-1 text-sm leading-5 text-foreground transition-colors",
        selected ? "bg-muted/70" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={hasChildren ? onExpand : undefined}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground",
          hasChildren ? "hover:bg-background" : "cursor-default",
        )}
        tabIndex={hasChildren ? 0 : -1}
        aria-hidden={!hasChildren}
      >
        {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
      </button>
      <button
        type="button"
        onClick={onClick}
        disabled={!selectable}
        className={cn(
          "ml-1 flex min-w-0 flex-1 items-center gap-2 text-left",
          selectable ? "cursor-pointer" : "cursor-default opacity-80",
        )}
        title={label}
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        {tag ? (
          <Badge
            variant="outline"
            className="shrink-0 border-border/60 bg-background/80 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
          >
            {tag}
          </Badge>
        ) : null}
      </button>
      <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center">
        {selectable && selected ? <Check size={14} strokeWidth={3} className="text-primary" /> : null}
      </span>
    </div>
  );
}

function KnowledgeTreeNodeList({
  nodes,
  parentId,
  depth,
  selectedIds,
  expandedNodes,
  visibleNodeIds,
  onToggleExpand,
  onToggleSelect,
}: {
  nodes: KnowledgeTreeNode[];
  parentId: string | null;
  depth: number;
  selectedIds: Set<string>;
  expandedNodes: Set<string>;
  visibleNodeIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (node: KnowledgeTreeNode) => void;
}) {
  const children = nodes.filter((node) => node.parent_id === parentId && visibleNodeIds.has(node.id));
  if (children.length === 0) return null;

  return (
    <div
      className="space-y-0.5"
      style={{ paddingLeft: `${depth > 0 ? 20 : 10}px` }}
    >
      {children.map((node) => {
        const hasChildren = nodes.some((item) => item.parent_id === node.id);
        const isExpanded = expandedNodes.has(node.id);
        const isSelected = selectedIds.has(node.id);
        const isSelectable = depth > 0;

        return (
          <div key={node.id} className="space-y-0.5">
            <KnowledgeTreeRow
              label={node.name}
              expanded={isExpanded}
              hasChildren={hasChildren}
              selected={isSelectable && isSelected}
              selectable={isSelectable}
              onExpand={() => onToggleExpand(node.id)}
              onClick={isSelectable ? () => onToggleSelect(node) : undefined}
              icon={hasChildren ? <KnowledgeIcon className="h-[13px] w-[13px]" /> : <File size={14} />}
              tag={depth === 0 ? "课程" : undefined}
            />
            {hasChildren && isExpanded && (
              <KnowledgeTreeNodeList
                nodes={nodes}
                parentId={node.id}
                depth={depth + 1}
                selectedIds={selectedIds}
                expandedNodes={expandedNodes}
                visibleNodeIds={visibleNodeIds}
                onToggleExpand={onToggleExpand}
                onToggleSelect={onToggleSelect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KnowledgePointSelector({
  fetcher,
  selectedKnowledgePoints,
  onSelectedKnowledgePointsChange,
  storageKey = "knowledge-point-selector-recent-keywords",
  label = "知识点",
  triggerLabel = "选择知识点",
  className,
  popoverSide = "right",
}: {
  fetcher: KnowledgePointSelectorFetcher;
  selectedKnowledgePoints: SelectedKnowledgePoint[];
  onSelectedKnowledgePointsChange: (value: SelectedKnowledgePoint[]) => void;
  storageKey?: string;
  label?: string;
  triggerLabel?: string;
  className?: string;
  popoverSide?: "top" | "right" | "bottom" | "left";
}) {
  const [majors, setMajors] = useState<KnowledgeMajor[]>([]);
  const [directions, setDirections] = useState<Record<string, KnowledgeDirection[]>>({});
  const [treeNodes, setTreeNodes] = useState<Record<string, KnowledgeTreeNode[]>>({});
  const [expandedMajors, setExpandedMajors] = useState<Set<string>>(new Set());
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [recentKnowledgePoints, setRecentKnowledgePoints] = useState<FrequentKnowledgePointItem[]>([]);
  const [frequentKnowledgePoints, setFrequentKnowledgePoints] = useState<FrequentKnowledgePointItem[]>([]);
  const [recentKeywords, setRecentKeywords] = useState<RecentKeywordState>({});

  const topRecentKeywords = useMemo(() => getTopRecentKeywords(recentKeywords, 6), [recentKeywords]);

  useEffect(() => {
    fetcher<KnowledgeMajor[]>("/knowledge/majors").then(setMajors).catch(() => {});
  }, [fetcher]);

  const loadFrequentKnowledgePoints = useCallback(async () => {
    const data = await fetcher<{ recent: FrequentKnowledgePointItem[]; frequent: FrequentKnowledgePointItem[] }>(
      "/questions/ai-generate/frequent-knowledge-points",
    );
    setRecentKnowledgePoints(data.recent);
    setFrequentKnowledgePoints(data.frequent);
  }, [fetcher]);

  useEffect(() => {
    void loadFrequentKnowledgePoints().catch(() => {});
  }, [loadFrequentKnowledgePoints]);

  useEffect(() => {
    try {
      const storedKeywords = localStorage.getItem(storageKey);
      if (storedKeywords) {
        setRecentKeywords(JSON.parse(storedKeywords));
      }
    } catch {
      // ignore bad local storage payload
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(recentKeywords));
  }, [recentKeywords, storageKey]);

  const loadDirections = useCallback(
    async (majorId: string) => {
      if (directions[majorId]) return;
      const nextDirections = await fetcher<KnowledgeDirection[]>(`/knowledge/majors/${majorId}/directions`);
      setDirections((prev) => ({ ...prev, [majorId]: nextDirections }));
    },
    [directions, fetcher],
  );

  const loadTree = useCallback(
    async (directionId: string) => {
      if (treeNodes[directionId]) return;
      const data = await fetcher<{ nodes: Array<{ id: string; data: KnowledgeTreeNode }> }>(
        `/knowledge/directions/${directionId}/tree`,
      );
      setTreeNodes((prev) => ({
        ...prev,
        [directionId]: data.nodes.map((node) => ({ ...node.data, id: node.id })),
      }));
    },
    [fetcher, treeNodes],
  );

  const ensureKnowledgeTreeReady = useCallback(async () => {
    if (majors.length === 0) return;
    setKnowledgeLoading(true);
    try {
      const directionsByMajor: Record<string, KnowledgeDirection[]> = {};
      for (const major of majors) {
        directionsByMajor[major.id] =
          directions[major.id] ??
          (await fetcher<KnowledgeDirection[]>(`/knowledge/majors/${major.id}/directions`));
      }
      setDirections((prev) => ({ ...directionsByMajor, ...prev }));

      const nextTrees: Record<string, KnowledgeTreeNode[]> = {};
      for (const dirs of Object.values(directionsByMajor)) {
        for (const dir of dirs) {
          if (treeNodes[dir.id]) continue;
          const data = await fetcher<{ nodes: Array<{ id: string; data: KnowledgeTreeNode }> }>(
            `/knowledge/directions/${dir.id}/tree`,
          );
          nextTrees[dir.id] = data.nodes.map((node) => ({ ...node.data, id: node.id }));
        }
      }
      if (Object.keys(nextTrees).length > 0) {
        setTreeNodes((prev) => ({ ...prev, ...nextTrees }));
      }
    } finally {
      setKnowledgeLoading(false);
    }
  }, [directions, fetcher, majors, treeNodes]);

  const toggleKnowledgePoint = useCallback(
    (node: KnowledgeTreeNode, majorName: string, directionName: string) => {
      onSelectedKnowledgePointsChange(
        selectedKnowledgePoints.some((item) => item.id === node.id)
          ? selectedKnowledgePoints.filter((item) => item.id !== node.id)
          : [
              ...selectedKnowledgePoints,
              { id: node.id, name: node.name, path: `${majorName} > ${directionName} > ${node.name}` },
            ],
      );
    },
    [onSelectedKnowledgePointsChange, selectedKnowledgePoints],
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {selectedKnowledgePoints.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectedKnowledgePoints.map((knowledgePoint) => (
            <Badge key={knowledgePoint.id} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[150px] truncate text-xs" title={knowledgePoint.path}>
                {knowledgePoint.name}
              </span>
              <button
                type="button"
                className="rounded-sm hover:bg-muted"
                onClick={() =>
                  onSelectedKnowledgePointsChange(
                    selectedKnowledgePoints.filter((item) => item.id !== knowledgePoint.id),
                  )
                }
              >
                <X size={12} />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (open) {
            void ensureKnowledgeTreeReady();
            void loadFrequentKnowledgePoints().catch(() => {});
          } else if (keyword.trim()) {
            setRecentKeywords((current) => buildRecentKeywordState(current, keyword));
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            type="button"
            className="w-full justify-between"
          >
            <span>
              {selectedKnowledgePoints.length > 0
                ? `已选 ${selectedKnowledgePoints.length} 个知识点`
                : triggerLabel}
            </span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side={popoverSide}
          align="start"
          sideOffset={12}
          collisionPadding={20}
          className="flex h-[min(640px,calc(100vh-2rem))] w-[min(560px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 border-b p-3">
            <div className="flex items-center rounded-lg border bg-background px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="border-0 px-0 shadow-none focus-visible:ring-0"
                placeholder="搜索专业、方向或知识点..."
              />
            </div>
            {topRecentKeywords.length > 0 ? (
              <div className="mt-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">常用搜索</p>
                <div className="flex flex-wrap gap-1.5">
                  {topRecentKeywords.map((item) => (
                    <button
                      key={item.keyword}
                      type="button"
                      className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      onClick={() => setKeyword(item.keyword)}
                    >
                      {item.keyword}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {recentKnowledgePoints.length > 0 ? (
              <div className="mt-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                  <Star size={12} />
                  最近使用
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recentKnowledgePoints.map((item) => {
                    const active = selectedKnowledgePoints.some((kp) => kp.id === item.id);
                    return (
                      <button
                        key={`recent-${item.id}`}
                        type="button"
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs transition",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        title={item.path}
                        onClick={() =>
                          onSelectedKnowledgePointsChange(
                            selectedKnowledgePoints.some((kp) => kp.id === item.id)
                              ? selectedKnowledgePoints.filter((kp) => kp.id !== item.id)
                              : [...selectedKnowledgePoints, { id: item.id, name: item.name, path: item.path }],
                          )
                        }
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {frequentKnowledgePoints.length > 0 ? (
              <div className="mt-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                  <Star size={12} />
                  常用知识点
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {frequentKnowledgePoints.map((item) => {
                    const active = selectedKnowledgePoints.some((kp) => kp.id === item.id);
                    return (
                      <button
                        key={`frequent-${item.id}`}
                        type="button"
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs transition",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        title={item.path}
                        onClick={() =>
                          onSelectedKnowledgePointsChange(
                            selectedKnowledgePoints.some((kp) => kp.id === item.id)
                              ? selectedKnowledgePoints.filter((kp) => kp.id !== item.id)
                              : [...selectedKnowledgePoints, { id: item.id, name: item.name, path: item.path }],
                          )
                        }
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
            {knowledgeLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                正在加载知识图谱...
              </div>
            ) : majors.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">暂无知识图谱数据</p>
            ) : (
              majors.map((major) => {
                const majorKeywordMatched =
                  keyword.trim() && major.name.toLowerCase().includes(keyword.trim().toLowerCase());
                const majorExpanded = keyword.trim() ? true : expandedMajors.has(major.id);
                const majorDirections = directions[major.id] ?? [];
                const visibleDirections = majorDirections.filter((direction) => {
                  const directionKeywordMatched =
                    keyword.trim() &&
                    direction.name.toLowerCase().includes(keyword.trim().toLowerCase());
                  const nodesForDirection = treeNodes[direction.id] ?? [];
                  const visibility = buildKnowledgeTreeVisibility(nodesForDirection, keyword);
                  return majorKeywordMatched || directionKeywordMatched || visibility.visibleNodeIds.size > 0;
                });
                if (keyword.trim() && !majorKeywordMatched && visibleDirections.length === 0) {
                  return null;
                }

                return (
                  <div key={major.id}>
                    <KnowledgeTreeRow
                      label={major.name}
                      expanded={majorExpanded}
                      hasChildren
                      onExpand={() => {
                        const next = new Set(expandedMajors);
                        if (next.has(major.id)) next.delete(major.id);
                        else {
                          next.add(major.id);
                          void loadDirections(major.id);
                        }
                        setExpandedMajors(next);
                      }}
                      onClick={() => {
                        const next = new Set(expandedMajors);
                        if (next.has(major.id)) next.delete(major.id);
                        else {
                          next.add(major.id);
                          void loadDirections(major.id);
                        }
                        setExpandedMajors(next);
                      }}
                      icon={<KnowledgeIcon className="h-[14px] w-[14px]" />}
                      tag="专业"
                    />

                    {majorExpanded && visibleDirections.map((direction) => {
                      const nodesForDirection = treeNodes[direction.id] ?? [];
                      const visibility = buildKnowledgeTreeVisibility(nodesForDirection, keyword);
                      const directionExpanded = keyword.trim() ? true : expandedDirections.has(direction.id);

                      return (
                        <div key={direction.id} className="pl-4">
                          <KnowledgeTreeRow
                            label={direction.name}
                            expanded={directionExpanded}
                            hasChildren
                            onExpand={() => {
                              const next = new Set(expandedDirections);
                              if (next.has(direction.id)) next.delete(direction.id);
                              else {
                                next.add(direction.id);
                                void loadTree(direction.id);
                              }
                              setExpandedDirections(next);
                            }}
                            onClick={() => {
                              const next = new Set(expandedDirections);
                              if (next.has(direction.id)) next.delete(direction.id);
                              else {
                                next.add(direction.id);
                                void loadTree(direction.id);
                              }
                              setExpandedDirections(next);
                            }}
                            icon={<KnowledgeIcon className="h-[13px] w-[13px]" />}
                            tag="方向"
                          />
                          {directionExpanded ? (
                            <KnowledgeTreeNodeList
                              nodes={nodesForDirection}
                              parentId={null}
                              depth={0}
                              selectedIds={new Set(selectedKnowledgePoints.map((item) => item.id))}
                              expandedNodes={
                                keyword.trim()
                                  ? new Set([...expandedNodes, ...visibility.autoExpandedNodeIds])
                                  : expandedNodes
                              }
                              visibleNodeIds={visibility.visibleNodeIds}
                              onToggleExpand={(id) => {
                                const next = new Set(expandedNodes);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                setExpandedNodes(next);
                              }}
                              onToggleSelect={(node) => toggleKnowledgePoint(node, major.name, direction.name)}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
