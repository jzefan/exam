import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Trash2, Loader2, StopCircle, FileQuestion, ChevronRight, ChevronDown, X, Bot, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { LatexText } from "@/components/ui/latex-text";
import type { QuestionType } from "@/types";
import { AIGenerateLoadingOverlay } from "./components/ai-generate-loading-overlay";
import {
  buildKnowledgeTreeVisibility,
  buildRecentKeywordState,
  getTopRecentKeywords,
  type RecentKeywordState,
  validateTypeAllocation,
} from "./ai-generate-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GeneratedQuestion {
  index: number;
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string };
  analysis: string | null;
  difficulty: number;
  selected: boolean;
}

interface TypeAllocation {
  choice: number;
  true_false: number;
  fill_in: number;
  short_answer: number;
  essay: number;
  code: number;
}

const TYPE_LABELS: Record<keyof TypeAllocation, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const TYPE_COLORS: Record<keyof TypeAllocation, string> = {
  choice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  true_false: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  fill_in: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  short_answer: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  essay: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  code: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "容易",
  2: "较易",
  3: "中等",
  4: "较难",
  5: "很难",
};

const MODEL_OPTIONS = [
  { value: "qwen", label: "通义千问", desc: "Qwen 3.5" },
  { value: "deepseek", label: "DeepSeek", desc: "DeepSeek Chat" },
  { value: "claude", label: "Claude", desc: "Claude Sonnet" },
] as const;

type ModelProvider = (typeof MODEL_OPTIONS)[number]["value"];

interface KnowledgeMajor {
  id: string;
  name: string;
}

interface KnowledgeDirection {
  id: string;
  major_id: string;
  name: string;
}

interface KnowledgeTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  direction_id: string | null;
}

interface SelectedKP {
  id: string;
  name: string;
  path: string; // e.g. "计算机科学 > 数据结构 > 二叉树"
}

const RECENT_KEYWORD_STORAGE_KEY = "question-ai-generate-recent-keywords";

interface FrequentKnowledgePointItem {
  id: string;
  name: string;
  path: string;
  use_count: number;
  last_used_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "请求失败");
  }
  return response.json() as Promise<T>;
}

function difficultyDots(level: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span
      key={i}
      className={`inline-block h-2 w-2 rounded-full ${
        i < level ? "bg-primary" : "bg-muted"
      }`}
    />
  ));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AIGeneratePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [totalCount, setTotalCount] = useState(10);
  const [difficulty, setDifficulty] = useState(3);
  const [typeAlloc, setTypeAlloc] = useState<TypeAllocation>({
    choice: 0,
    true_false: 0,
    fill_in: 0,
    short_answer: 0,
    essay: 0,
    code: 0,
  });
  const [model, setModel] = useState<ModelProvider>("qwen");
  const [selectedKPs, setSelectedKPs] = useState<SelectedKP[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");

  // Knowledge tree state
  const [majors, setMajors] = useState<KnowledgeMajor[]>([]);
  const [directions, setDirections] = useState<Record<string, KnowledgeDirection[]>>({});
  const [treeNodes, setTreeNodes] = useState<Record<string, KnowledgeTreeNode[]>>({});
  const [expandedMajors, setExpandedMajors] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [kpPopoverOpen, setKpPopoverOpen] = useState(false);
  const [kpKeyword, setKpKeyword] = useState("");
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [recentKPs, setRecentKPs] = useState<FrequentKnowledgePointItem[]>([]);
  const [frequentKPs, setFrequentKPs] = useState<FrequentKnowledgePointItem[]>([]);
  const [recentKeywords, setRecentKeywords] = useState<RecentKeywordState>({});

  // Load majors on mount
  useEffect(() => {
    apiFetch<KnowledgeMajor[]>("/api/knowledge/majors").then(setMajors).catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch<{ recent: FrequentKnowledgePointItem[]; frequent: FrequentKnowledgePointItem[] }>(
      "/api/questions/ai-generate/frequent-knowledge-points",
    )
      .then((data) => {
        setRecentKPs(data.recent);
        setFrequentKPs(data.frequent);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const storedKeywords = localStorage.getItem(RECENT_KEYWORD_STORAGE_KEY);
      if (storedKeywords) setRecentKeywords(JSON.parse(storedKeywords));
    } catch {
      // ignore broken local storage payload
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(RECENT_KEYWORD_STORAGE_KEY, JSON.stringify(recentKeywords));
  }, [recentKeywords]);

  const loadFrequentKnowledgePoints = useCallback(async () => {
    const data = await apiFetch<{ recent: FrequentKnowledgePointItem[]; frequent: FrequentKnowledgePointItem[] }>(
      "/api/questions/ai-generate/frequent-knowledge-points",
    );
    setRecentKPs(data.recent);
    setFrequentKPs(data.frequent);
  }, []);

  const loadDirections = useCallback(async (majorId: string) => {
    if (directions[majorId]) return;
    const dirs = await apiFetch<KnowledgeDirection[]>(`/api/knowledge/majors/${majorId}/directions`);
    setDirections((prev) => ({ ...prev, [majorId]: dirs }));
  }, [directions]);

  const loadTree = useCallback(async (directionId: string) => {
    if (treeNodes[directionId]) return;
    const data = await apiFetch<{ nodes: Array<{ id: string; data: KnowledgeTreeNode }> }>(
      `/api/knowledge/directions/${directionId}/tree`,
    );
    const nodes = data.nodes.map((n) => ({ ...n.data, id: n.id }));
    setTreeNodes((prev) => ({ ...prev, [directionId]: nodes }));
  }, [treeNodes]);

  const ensureKnowledgeTreeReady = useCallback(async () => {
    if (majors.length === 0) return;
    setKnowledgeLoading(true);
    try {
      const directionsByMajor: Record<string, KnowledgeDirection[]> = {};
      for (const major of majors) {
        directionsByMajor[major.id] = directions[major.id] ?? await apiFetch<KnowledgeDirection[]>(
          `/api/knowledge/majors/${major.id}/directions`,
        );
      }
      setDirections((prev) => ({ ...directionsByMajor, ...prev }));

      const nextTrees: Record<string, KnowledgeTreeNode[]> = {};
      for (const dirs of Object.values(directionsByMajor)) {
        for (const dir of dirs) {
          if (treeNodes[dir.id]) continue;
          const data = await apiFetch<{ nodes: Array<{ id: string; data: KnowledgeTreeNode }> }>(
            `/api/knowledge/directions/${dir.id}/tree`,
          );
          nextTrees[dir.id] = data.nodes.map((n) => ({ ...n.data, id: n.id }));
        }
      }
      if (Object.keys(nextTrees).length > 0) {
        setTreeNodes((prev) => ({ ...prev, ...nextTrees }));
      }
    } finally {
      setKnowledgeLoading(false);
    }
  }, [majors, directions, treeNodes]);

  const toggleKP = useCallback((node: KnowledgeTreeNode, majorName: string, dirName: string) => {
    setSelectedKPs((prev) => {
      const exists = prev.find((kp) => kp.id === node.id);
      if (exists) return prev.filter((kp) => kp.id !== node.id);
      return [...prev, { id: node.id, name: node.name, path: `${majorName} > ${dirName} > ${node.name}` }];
    });
  }, []);

  // Generation state
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const allocationState = validateTypeAllocation(totalCount, typeAlloc);
  const allocSum = allocationState.allocated;
  const allocMismatch = !allocationState.isValid;

  const selectedCount = questions.filter((q) => q.selected).length;
  const topRecentKeywords = getTopRecentKeywords(recentKeywords, 6);

  /* ---- generation ---- */

  const startGeneration = useCallback(async () => {
    if (!allocationState.isValid) {
      toast({
        title: "题型数量不一致",
        description: `当前题型数量之和为 ${allocationState.allocated}，必须与题目总数 ${totalCount} 一致。`,
        variant: "destructive",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setQuestions([]);

    const typeDistribution: Record<string, number> = {};
    for (const [k, v] of Object.entries(typeAlloc)) {
      if (v > 0) typeDistribution[k] = v;
    }

    const requestBody = {
      total_count: totalCount,
      difficulty,
      type_distribution: Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
      knowledge_point_ids: selectedKPs.length > 0 ? selectedKPs.map((kp) => kp.id) : undefined,
      prompt: customPrompt.trim() || undefined,
      model,
    };

    try {
      if (kpKeyword.trim()) {
        setRecentKeywords((current) => buildRecentKeywordState(current, kpKeyword));
      }
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail ?? `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let questionIndex = 0;
      let streamFailed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));

            if (event.type === "question") {
              if (questionIndex >= totalCount) {
                continue;
              }
              const q: GeneratedQuestion = {
                index: questionIndex++,
                type: event.data.type ?? "choice",
                title: event.data.title ?? "",
                content: { text: event.data.content?.text ?? event.data.title ?? "" },
                options: event.data.options ?? null,
                answer: event.data.answer ?? {},
                analysis: event.data.analysis ?? null,
                difficulty: event.data.difficulty ?? difficulty,
                selected: true,
              };
              setQuestions((prev) => [...prev, q]);
            } else if (event.type === "error") {
              toast({
                title: "生成出错",
                description: event.message ?? "未知错误",
                variant: "destructive",
              });
              streamFailed = true;
              await reader.cancel();
              break;
            }
          } catch {
            // skip malformed events
          }
        }

        if (streamFailed) {
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({
          title: "生成失败",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
      void loadFrequentKnowledgePoints().catch(() => {});
    }
  }, [allocationState, totalCount, difficulty, typeAlloc, selectedKPs, customPrompt, model, toast, kpKeyword, loadFrequentKnowledgePoints]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ---- selection ---- */

  const toggleSelect = (index: number) => {
    setQuestions((prev) =>
      prev.map((q) => (q.index === index ? { ...q, selected: !q.selected } : q)),
    );
  };

  const toggleSelectAll = () => {
    const allSelected = questions.every((q) => q.selected);
    setQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((q) => q.index !== index));
  };

  /* ---- save ---- */

  const saveToBank = useCallback(async () => {
    const selected = questions.filter((q) => q.selected);
    if (selected.length === 0) {
      toast({ title: "请至少选择一道题目", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      // Find or create AI题库
      const banks = await apiFetch<Array<{ id: string; name: string }>>("/api/question-banks");
      let bankId: string;
      const aiBank = banks.find((b) => b.name === "AI题库");
      if (aiBank) {
        bankId = aiBank.id;
      } else {
        const created = await apiFetch<{ id: string }>("/api/question-banks", {
          method: "POST",
          body: JSON.stringify({ name: "AI题库", description: "AI自动生成的题目" }),
        });
        bankId = created.id;
      }

      // Bulk create
      const payload = selected.map((q) => ({
        type: q.type,
        title: q.title,
        content: q.content,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        difficulty: q.difficulty,
        score: 10,
        tag_ids: [],
        knowledge_point_ids: [],
        question_bank_id: bankId,
      }));

      await apiFetch<{ created: number }>("/api/questions/bulk", {
        method: "POST",
        body: JSON.stringify({ questions: payload }),
      });

      toast({ title: `已保存 ${selected.length} 道题目到「AI题库」` });
      navigate("/questions");
    } catch (err) {
      toast({
        title: "保存失败",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [questions, toast, navigate]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full gap-6 p-6">
      {/* ---- Left: Config Panel ---- */}
      <aside className="sticky top-6 flex w-[380px] shrink-0 flex-col gap-5 self-start rounded-lg border bg-card p-5">
        <h1 className="text-base font-semibold">AI 智能出题</h1>

        {/* Total count */}
        <div className="space-y-1.5">
          <Label>题目总数</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={totalCount}
            onChange={(e) => setTotalCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>

        {/* Difficulty */}
        <div className="space-y-1.5">
          <Label>难度</Label>
          <Select
            value={String(difficulty)}
            onValueChange={(v) => setDifficulty(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {DIFFICULTY_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Type allocation */}
        <div className="space-y-2">
          <Label>题型分配</Label>
          {allocMismatch && (
            <p className="text-xs text-destructive">
              题型数量之和 ({allocSum}) 与题目总数 ({totalCount}) 不一致
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(Object.keys(TYPE_LABELS) as Array<keyof TypeAllocation>).map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-16 text-xs text-muted-foreground">{TYPE_LABELS[key]}</span>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  className="h-8 w-16"
                  value={typeAlloc[key]}
                  onChange={(e) =>
                    setTypeAlloc((prev) => ({
                      ...prev,
                      [key]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Model selection */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Bot size={14} />AI 模型</Label>
          <Select value={model} onValueChange={(v) => setModel(v as ModelProvider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  <span>{m.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{m.desc}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Knowledge points */}
        <div className="space-y-1.5">
          <Label>知识点</Label>
          {selectedKPs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedKPs.map((kp) => (
                <Badge key={kp.id} variant="secondary" className="gap-1 pr-1">
                  <span className="max-w-[150px] truncate text-xs" title={kp.path}>{kp.name}</span>
                  <button
                    type="button"
                    className="rounded-sm hover:bg-muted"
                    onClick={() => setSelectedKPs((prev) => prev.filter((k) => k.id !== kp.id))}
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Popover
            open={kpPopoverOpen}
            onOpenChange={(open) => {
              setKpPopoverOpen(open);
              if (open) {
                void ensureKnowledgeTreeReady();
                void loadFrequentKnowledgePoints().catch(() => {});
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between">
                <span>{selectedKPs.length > 0 ? `已选 ${selectedKPs.length} 个知识点` : "选择知识点"}</span>
                <ChevronDown size={14} className="text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              sideOffset={12}
              collisionPadding={16}
              className="h-[560px] w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
            >
              <div className="border-b p-3">
                <div className="flex items-center rounded-lg border bg-background px-3">
                  <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={kpKeyword}
                    onChange={(e) => setKpKeyword(e.target.value)}
                    className="border-0 px-0 shadow-none focus-visible:ring-0"
                    placeholder="搜索专业、方向或知识点..."
                  />
                </div>
                {topRecentKeywords.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">常用搜索</p>
                    <div className="flex flex-wrap gap-1.5">
                      {topRecentKeywords.map((item) => (
                        <button
                          key={item.keyword}
                          type="button"
                          className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          onClick={() => setKpKeyword(item.keyword)}
                        >
                          {item.keyword}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {recentKPs.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      <Star size={12} />
                      最近使用
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {recentKPs.map((item) => {
                        const active = selectedKPs.some((kp) => kp.id === item.id);
                        return (
                          <button
                            key={`recent-${item.id}`}
                            type="button"
                            className={`rounded-full px-2.5 py-1 text-xs transition ${
                              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                            }`}
                            title={item.path}
                            onClick={() =>
                              setSelectedKPs((prev) =>
                                prev.some((kp) => kp.id === item.id)
                                  ? prev.filter((kp) => kp.id !== item.id)
                                  : [...prev, { id: item.id, name: item.name, path: item.path }]
                              )
                            }
                          >
                            {item.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {frequentKPs.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      <Star size={12} />
                      常用知识点
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {frequentKPs.map((item) => {
                        const active = selectedKPs.some((kp) => kp.id === item.id);
                        return (
                          <button
                            key={`frequent-${item.id}`}
                            type="button"
                            className={`rounded-full px-2.5 py-1 text-xs transition ${
                              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                            }`}
                            title={item.path}
                            onClick={() =>
                              setSelectedKPs((prev) =>
                                prev.some((kp) => kp.id === item.id)
                                  ? prev.filter((kp) => kp.id !== item.id)
                                  : [...prev, { id: item.id, name: item.name, path: item.path }]
                              )
                            }
                          >
                            {item.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="h-[calc(560px-172px)] overflow-y-auto p-2 text-sm">
                {knowledgeLoading ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    正在加载知识图谱...
                  </div>
                ) : majors.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">暂无知识图谱数据</p>
                ) : (
                  majors.map((major) => {
                    const majorKeywordMatched = kpKeyword.trim() && major.name.toLowerCase().includes(kpKeyword.trim().toLowerCase());
                    const majorExpanded = kpKeyword.trim() ? true : expandedMajors.has(major.id);
                    const majorDirections = directions[major.id] ?? [];
                    const visibleDirections = majorDirections.filter((dir) => {
                      const dirKeywordMatched = kpKeyword.trim() && dir.name.toLowerCase().includes(kpKeyword.trim().toLowerCase());
                      const nodesForDir = treeNodes[dir.id] ?? [];
                      const visibility = buildKnowledgeTreeVisibility(nodesForDir, kpKeyword);
                      return majorKeywordMatched || dirKeywordMatched || visibility.visibleNodeIds.size > 0;
                    });
                    if (kpKeyword.trim() && !majorKeywordMatched && visibleDirections.length === 0) return null;

                    return (
                      <div key={major.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded px-2 py-1 font-medium hover:bg-muted"
                          onClick={() => {
                            const next = new Set(expandedMajors);
                            if (next.has(major.id)) next.delete(major.id);
                            else {
                              next.add(major.id);
                              void loadDirections(major.id);
                            }
                            setExpandedMajors(next);
                          }}
                        >
                          {majorExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {major.name}
                        </button>

                        {majorExpanded && visibleDirections.map((dir) => {
                          const nodesForDir = treeNodes[dir.id] ?? [];
                          const visibility = buildKnowledgeTreeVisibility(nodesForDir, kpKeyword);
                          const dirExpanded = kpKeyword.trim() ? true : expandedDirs.has(dir.id);
                          return (
                            <div key={dir.id} className="pl-4">
                              <button
                                type="button"
                                className="flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-muted"
                                onClick={() => {
                                  const next = new Set(expandedDirs);
                                  if (next.has(dir.id)) next.delete(dir.id);
                                  else {
                                    next.add(dir.id);
                                    void loadTree(dir.id);
                                  }
                                  setExpandedDirs(next);
                                }}
                              >
                                {dirExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {dir.name}
                              </button>
                              {dirExpanded && (
                                <KPNodeList
                                  nodes={nodesForDir}
                                  parentId={null}
                                  depth={0}
                                  selectedIds={new Set(selectedKPs.map((k) => k.id))}
                                  expandedNodes={
                                    kpKeyword.trim()
                                      ? new Set([...expandedNodes, ...visibility.autoExpandedNodeIds])
                                      : expandedNodes
                                  }
                                  visibleNodeIds={visibility.visibleNodeIds}
                                  onToggleExpand={(id) => {
                                    const next = new Set(expandedNodes);
                                    if (next.has(id)) next.delete(id); else next.add(id);
                                    setExpandedNodes(next);
                                  }}
                                  onToggleSelect={(node) => toggleKP(node, major.name, dir.name)}
                                />
                              )}
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

        {/* Custom prompt */}
        <div className="space-y-1.5">
          <Label>自定义提示</Label>
          <Textarea
            placeholder="对生成题目的额外要求..."
            rows={3}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {!isGenerating ? (
            <Button
              className="flex-1"
              onClick={startGeneration}
              disabled={isGenerating || (allocationState.hasCustomAllocation && !allocationState.isValid)}
            >
              <Sparkles size={16} />
              开始生成
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={stopGeneration}
            >
              <StopCircle size={16} />
              停止生成
            </Button>
          )}
        </div>

        {isGenerating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            生成中... 已生成 {questions.length} 道
          </div>
        )}
      </aside>

      {/* ---- Right: Results Panel ---- */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {questions.length === 0 && !isGenerating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileQuestion size={48} strokeWidth={1.5} />
            <p>配置参数后点击开始生成</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto pb-20">
              {questions.map((q) => (
                <div
                  key={q.index}
                  className="rounded-lg border bg-card p-4 transition-colors"
                >
                  {/* Card header */}
                  <div className="mb-2 flex items-center gap-2">
                    <Checkbox
                      checked={q.selected}
                      onCheckedChange={() => toggleSelect(q.index)}
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      #{q.index + 1}
                    </span>
                    <Badge
                      variant="secondary"
                      className={TYPE_COLORS[q.type as keyof TypeAllocation] ?? ""}
                    >
                      {TYPE_LABELS[q.type as keyof TypeAllocation] ?? q.type}
                    </Badge>
                    <div className="flex items-center gap-0.5">
                      {difficultyDots(q.difficulty)}
                    </div>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeQuestion(q.index)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>

                  {/* Title */}
                  <p className="mb-1 text-sm font-medium">
                    <LatexText>{q.title}</LatexText>
                  </p>

                  {/* Content */}
                  {q.content.text && q.content.text !== q.title && (
                    <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      <LatexText>{q.content.text}</LatexText>
                    </p>
                  )}

                  {/* Options */}
                  {q.options && Object.keys(q.options).length > 0 && (
                    <div className="mb-2 space-y-0.5 pl-2">
                      {Object.entries(q.options).map(([key, value]) => (
                        <p key={key} className="text-sm">
                          <span className="mr-1 font-medium">{key}.</span>
                          <LatexText>{value}</LatexText>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Answer */}
                  <div className="mt-2 rounded bg-muted/50 p-2 text-sm">
                    <span className="font-medium text-primary">答案：</span>
                    <LatexText>{q.answer.correct ?? q.answer.text ?? JSON.stringify(q.answer)}</LatexText>
                  </div>

                  {/* Analysis */}
                  {q.analysis && (
                    <div className="mt-1 rounded bg-muted/30 p-2 text-sm text-muted-foreground">
                      <span className="font-medium">解析：</span>
                      <LatexText>{q.analysis}</LatexText>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom action bar */}
            {questions.length > 0 && (
              <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {questions.every((q) => q.selected) ? "取消全选" : "全选"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  已选择 {selectedCount}/{questions.length} 道题目
                </span>
                <div className="flex-1" />
                <Button onClick={saveToBank} disabled={isSaving || selectedCount === 0}>
                  {isSaving && <Loader2 size={14} className="animate-spin" />}
                  保存到题库
                </Button>
              </div>
            )}
          </>
        )}
        {isGenerating && <AIGenerateLoadingOverlay generatedCount={questions.length} />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Knowledge Point Tree Node List                                     */
/* ------------------------------------------------------------------ */

function KPNodeList({
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
  const children = nodes.filter((n) => n.parent_id === parentId && visibleNodeIds.has(n.id));
  if (children.length === 0) return null;

  return (
    <div style={{ paddingLeft: `${depth > 0 ? 12 : 8}px` }}>
      {children.map((node) => {
        const hasChildren = nodes.some((n) => n.parent_id === node.id);
        const isExpanded = expandedNodes.has(node.id);
        const isSelected = selectedIds.has(node.id);

        return (
          <div key={node.id}>
            <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted">
              {hasChildren ? (
                <button type="button" onClick={() => onToggleExpand(node.id)} className="shrink-0">
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <Checkbox
                className="h-3.5 w-3.5"
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(node)}
              />
              <button
                type="button"
                className="min-w-0 truncate text-left text-xs"
                onClick={() => onToggleSelect(node)}
                title={node.name}
              >
                {node.name}
              </button>
            </div>
            {hasChildren && isExpanded && (
              <KPNodeList
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
