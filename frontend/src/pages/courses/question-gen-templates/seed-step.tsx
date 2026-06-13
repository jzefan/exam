// Step 3 of the 出题技能 editor: seed questions (种子题).
//
// Seeds should cover every question type (1~2 each) so the AI can borrow a
// style sample per type. Three入口, ordered by what a teacher reaches for first:
//   1) 导入试卷（推荐/默认）— upload a past paper, auto-recognize into typed seeds.
//   2) 从题库选择 — pick a type first, then pick questions of that type.
//   3) 手动添加（最后）— pick a type, paste a stem, AI completes answer + analysis.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  FileUp,
  Library,
  Loader2,
  PenLine,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import { QuestionSelector } from "@/pages/exams/components/QuestionSelector";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { getCourseKnowledgeTree, type CourseKnowledgeNode } from "@/pages/courses/api";
import {
  extractMaterialContent,
  UnsupportedMaterialFormatError,
} from "@/pages/knowledge/extract-material-content";
import type { IQuestion, QuestionType } from "@/types";
import {
  recognizeQuestionListSeeds,
  recognizeStandardPaperSeeds,
  type RecognizedSeed,
} from "./api";
import type { ManualSeed } from "./types";

export interface BankSeed {
  id: string;
  title: string;
  type?: string | null;
}

const TYPE_META: Record<string, { label: string; className: string }> = {
  choice: { label: "选择题", className: "border-primary/25 bg-primary/10 text-primary" },
  true_false: { label: "判断题", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  fill_in: { label: "填空题", className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  short_answer: { label: "简答题", className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  essay: { label: "论述题", className: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  code: { label: "编程题", className: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
};
const TYPE_ORDER: QuestionType[] = ["choice", "true_false", "fill_in", "short_answer", "essay", "code"];

type SeedMethod = "import" | "bank" | "manual";

function typeLabel(type?: string | null): string {
  return (type && TYPE_META[type]?.label) || "未分类";
}

async function extractText(file: File): Promise<{ text: string; source_format: "pdf" | "docx" | "md" }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "md") {
    return { text: await file.text(), source_format: "md" };
  }
  const extracted = await extractMaterialContent(file);
  const source_format = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "md";
  return { text: extracted.text, source_format };
}

function flattenCourseKps(node: CourseKnowledgeNode | null): SelectedKnowledgePoint[] {
  if (!node) return [];
  const out: SelectedKnowledgePoint[] = [];
  const walk = (n: CourseKnowledgeNode, parentPath: string) => {
    const path = parentPath ? `${parentPath} > ${n.name}` : n.name;
    out.push({ id: n.id, name: n.name, path });
    n.children?.forEach((child) => walk(child, path));
  };
  // 跳过根节点（课程本身），只收录其下的知识点。
  node.children?.forEach((child) => walk(child, ""));
  return out;
}

export function SeedStep({
  courseId,
  bankSeeds,
  setBankSeeds,
  manualSeeds,
  setManualSeeds,
}: {
  courseId: string;
  bankSeeds: BankSeed[];
  setBankSeeds: (next: BankSeed[]) => void;
  manualSeeds: ManualSeed[];
  setManualSeeds: (next: ManualSeed[]) => void;
}) {
  const { toast } = useToast();

  // Which entry method is active — the three are mutually exclusive (pick one),
  // not a sequential checklist. Import is the default (most convenient).
  const [method, setMethod] = useState<SeedMethod>("import");

  // 1) Import — 自动支持两种试卷：正式试卷（含封面/答题卡/得分栏）与题目清单。
  // 按文件类型路由到最合适的识别管线，无需用户选择。
  const [importing, setImporting] = useState(false);
  const [recognized, setRecognized] = useState<RecognizedSeed[]>([]);
  const [recognizeSel, setRecognizeSel] = useState<Set<number>>(new Set());
  const [recognizeExpanded, setRecognizeExpanded] = useState<Set<number>>(new Set());
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 2) Bank by type — 点题型进入全屏选题，题型/知识点可在选题界面继续调整。
  const [bankInitialType, setBankInitialType] = useState<QuestionType | undefined>(undefined);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankDialogSel, setBankDialogSel] = useState<string[]>([]);
  const [bankConfirming, setBankConfirming] = useState(false);

  // 3) Manual — 粘贴题干，自动识别题型并补全答案/解析。
  const [manualText, setManualText] = useState("");
  const [completing, setCompleting] = useState(false);

  // 课程相关知识点（用于限定选题界面的知识点过滤）。
  const [courseKpOptions, setCourseKpOptions] = useState<SelectedKnowledgePoint[]>([]);

  // 已添加种子题的展开状态：bank 懒加载题目详情，manual 直接展开。
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [bankDetail, setBankDetail] = useState<Record<string, IQuestion>>({});
  const [bankDetailLoading, setBankDetailLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    getCourseKnowledgeTree(courseId)
      .then((tree) => setCourseKpOptions(flattenCourseKps(tree)))
      .catch(() => setCourseKpOptions([]));
  }, [courseId]);

  const coverage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of bankSeeds) counts[s.type ?? "unknown"] = (counts[s.type ?? "unknown"] ?? 0) + 1;
    for (const s of manualSeeds) counts[s.type ?? "unknown"] = (counts[s.type ?? "unknown"] ?? 0) + 1;
    return counts;
  }, [bankSeeds, manualSeeds]);

  const total = bankSeeds.length + manualSeeds.length;

  // --- Import ---------------------------------------------------------------
  const handleImportFile = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        let seeds: RecognizedSeed[];
        if (ext === "pdf" || ext === "docx") {
          // 正式试卷几乎都是 PDF/Word：走多模态识别，跳过封面/答题卡/得分栏。
          seeds = await recognizeStandardPaperSeeds(file);
        } else {
          // 题目清单等轻量格式（txt/md/pptx）：走文本识别。
          const { text, source_format } = await extractText(file);
          if (!text.trim()) {
            toast({ title: "未读取到文本", description: "无法从该文件提取内容。", variant: "destructive" });
            return;
          }
          seeds = await recognizeQuestionListSeeds({ file_name: file.name, raw_text: text, source_format });
        }
        if (seeds.length === 0) {
          toast({ title: "未识别到题目", description: "请检查文件后重试。", variant: "destructive" });
          return;
        }
        // 导入试卷的题目全部默认作为种子题（可在对话框里取消勾选不需要的）。
        setRecognized(seeds);
        setRecognizeSel(new Set(seeds.map((_, i) => i)));
        setRecognizeExpanded(new Set());
        setRecognizeOpen(true);
      } catch (error) {
        toast({
          title: "导入失败",
          description:
            error instanceof UnsupportedMaterialFormatError || error instanceof Error
              ? error.message
              : "文件解析失败",
          variant: "destructive",
        });
      } finally {
        setImporting(false);
      }
    },
    [toast],
  );

  const confirmImport = useCallback(() => {
    const picked: ManualSeed[] = recognized
      .filter((_, i) => recognizeSel.has(i))
      .map((s) => ({ type: s.type, text: s.text, options: s.options ?? null, answer: s.answer ?? null, analysis: s.analysis ?? null }));
    setManualSeeds([...manualSeeds, ...picked]);
    setRecognizeOpen(false);
    setRecognized([]);
    setRecognizeSel(new Set());
    setRecognizeExpanded(new Set());
    if (picked.length > 0) toast({ title: `已加入 ${picked.length} 道种子题` });
  }, [recognized, recognizeSel, manualSeeds, setManualSeeds, toast]);

  // --- Bank by type ---------------------------------------------------------
  const openBankForType = useCallback(
    (type: QuestionType) => {
      setBankInitialType(type);
      setBankDialogSel(bankSeeds.map((s) => s.id)); // keep existing selections intact
      setBankDialogOpen(true);
    },
    [bankSeeds],
  );

  const toggleBankExpand = useCallback(
    (seed: BankSeed) => {
      setExpandedKey((prev) => (prev === `bank-${seed.id}` ? null : `bank-${seed.id}`));
      if (bankDetail[seed.id] || bankDetailLoading.has(seed.id)) return;
      setBankDetailLoading((prev) => new Set(prev).add(seed.id));
      apiRequest<IQuestion>(`/questions/${seed.id}`)
        .then((q) => setBankDetail((prev) => ({ ...prev, [seed.id]: q })))
        .catch(() => undefined)
        .finally(() =>
          setBankDetailLoading((prev) => {
            const next = new Set(prev);
            next.delete(seed.id);
            return next;
          }),
        );
    },
    [bankDetail, bankDetailLoading],
  );

  const confirmBank = useCallback(async () => {
    setBankConfirming(true);
    try {
      const newIds = bankDialogSel.filter((id) => !bankSeeds.some((s) => s.id === id));
      const added = await Promise.all(
        newIds.map(async (qid) => {
          try {
            const q = await apiRequest<{ id: string; title: string; type: string }>(`/questions/${qid}`);
            return { id: qid, title: q.title || "题库题目", type: q.type };
          } catch {
            return { id: qid, title: "题库题目", type: null };
          }
        }),
      );
      setBankSeeds([...bankSeeds.filter((s) => bankDialogSel.includes(s.id)), ...added]);
      setBankDialogOpen(false);
    } finally {
      setBankConfirming(false);
    }
  }, [bankDialogSel, bankSeeds, setBankSeeds]);

  // --- Manual ---------------------------------------------------------------
  // 粘贴题干 → 自动识别题型并补全答案/解析（复用题目识别管线，无需选题型）。
  const handleManualComplete = useCallback(async () => {
    if (!manualText.trim()) return;
    setCompleting(true);
    try {
      const seeds = await recognizeQuestionListSeeds({
        file_name: "manual.md",
        raw_text: manualText.trim(),
        source_format: "md",
      });
      if (seeds.length === 0) {
        toast({ title: "未能识别题目", description: "请检查粘贴的内容后重试。", variant: "destructive" });
        return;
      }
      const added: ManualSeed[] = seeds.map((s) => ({
        type: s.type,
        text: s.text,
        options: s.options ?? null,
        answer: s.answer ?? null,
        analysis: s.analysis ?? null,
      }));
      setManualSeeds([...manualSeeds, ...added]);
      setManualText("");
      toast({ title: `已识别并添加 ${added.length} 道种子题` });
    } catch (error) {
      toast({ title: "识别失败", description: String(error), variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  }, [manualText, manualSeeds, setManualSeeds, toast]);

  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-muted-foreground">
        种子题是<span className="text-foreground">各题型的风格样本</span>，建议每个题型放 1~2 道，AI 出题时会模仿它们的风格与难度（不会照抄）。可跳过，之后随时补充。
      </p>

      {/* 题型覆盖度 */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_ORDER.map((type) => {
          const n = coverage[type] ?? 0;
          return (
            <span
              key={type}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                n > 0 ? TYPE_META[type].className : "border-dashed border-border/70 text-muted-foreground",
              )}
            >
              {TYPE_META[type].label} {n > 0 ? `×${n}` : "待补充"}
            </span>
          );
        })}
      </div>

      {/* 三选一的录入方式（互斥）：选一种方式添加，并非依次完成 */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">选择一种方式添加种子题：</p>
        <Tabs value={method} onValueChange={(v) => setMethod(v as SeedMethod)}>
          <TabsList className="bg-muted/60">
            <TabsTrigger value="import" className="gap-1.5 px-[15px]">
              <FileUp size={14} />
              导入试卷
              <span className="rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">推荐</span>
            </TabsTrigger>
            <TabsTrigger value="bank" className="gap-1.5 px-[15px]">
              <Library size={14} />
              从题库选择
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5 px-[15px]">
              <PenLine size={14} />
              手动添加
            </TabsTrigger>
          </TabsList>

          {/* 方式一：导入试卷（推荐） */}
          <TabsContent value="import" className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx,.pdf,.pptx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-8 transition-colors",
                importing
                  ? "border-border/50 bg-muted/20"
                  : isDragActive
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-primary/40 hover:bg-muted/20",
              )}
              onClick={() => !importing && fileInputRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); setIsDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
                  setIsDragActive(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleImportFile(file);
              }}
            >
              {importing ? (
                <>
                  <Loader2 size={28} className="animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">AI 识别题目中…</p>
                </>
              ) : (
                <>
                  <Upload size={28} className={cn("transition-colors", isDragActive ? "text-primary" : "text-muted-foreground/60")} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">拖拽试卷到这里，或点击选择</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      支持 docx / pdf / txt / md / pptx，正式试卷或题目清单都行，自动识别成各题型种子题
                    </p>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* 方式二：从题库选择（先选题型） */}
          <TabsContent value="bank" className="mt-3">
            <div className="rounded-lg border border-border/70 p-4">
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                先选题型，再从该题型的题目中挑选（被选中的题会在题库列表标注所属技能）。
              </p>
              <div className="flex flex-wrap gap-2">
                {TYPE_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => openBankForType(type)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {TYPE_META[type].label}
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* 方式三：手动添加 */}
          <TabsContent value="manual" className="mt-3">
            <div className="rounded-lg border border-border/70 p-4">
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                直接粘贴题目内容，系统自动识别题型并补全参考答案与解析——无需手动选题型。
              </p>
              <Textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={4}
                placeholder="粘贴一道题（可含选项、答案）…系统会自动识别题型并补全答案与解析。"
                className="mb-2 text-sm"
              />
              <Button
                type="button"
                size="sm"
                disabled={!manualText.trim() || completing}
                onClick={() => void handleManualComplete()}
              >
                {completing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Wand2 size={14} className="mr-1.5" />}
                {completing ? "识别中…" : "识别并添加"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 已添加列表 */}
      {total > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">已添加 {total} 道种子题</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {bankSeeds.map((seed) => {
              const key = `bank-${seed.id}`;
              const open = expandedKey === key;
              const detail = bankDetail[seed.id];
              const loadingDetail = bankDetailLoading.has(seed.id);
              return (
                <div key={key} className="rounded-md border border-border/70 bg-muted/20 text-xs">
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <Badge variant="outline" className={cn("shrink-0", TYPE_META[seed.type ?? ""]?.className)}>
                      {typeLabel(seed.type)}
                    </Badge>
                    <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                      题库
                    </Badge>
                    <button
                      type="button"
                      onClick={() => toggleBankExpand(seed)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate" title={seed.title}>
                        {seed.title}
                      </span>
                      <ChevronDown
                        size={14}
                        className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="移除"
                      onClick={() => setBankSeeds(bankSeeds.filter((s) => s.id !== seed.id))}
                    >
                      <X size={13} className="text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-dashed border-border/60 px-2.5 py-2">
                      {loadingDetail ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 size={12} className="animate-spin" /> 加载题目详情…
                        </p>
                      ) : detail ? (
                        <QuestionPreviewCard
                          question={detail}
                          mode="detailed"
                          defaultExpanded
                          markChoiceAnswer
                          className="border-0 bg-transparent p-0 shadow-none"
                        />
                      ) : (
                        <p className="text-[11px] text-muted-foreground">题目详情加载失败。</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {manualSeeds.map((seed, index) => {
              const key = `manual-${index}`;
              const open = expandedKey === key;
              const seedOptions = seed.options && Object.keys(seed.options).length > 0 ? seed.options : null;
              const hasDetail = Boolean(seedOptions || (seed.answer ?? "").trim() || (seed.analysis ?? "").trim());
              return (
                <div key={key} className="rounded-md border border-border/70 bg-muted/20 text-xs">
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <Badge variant="outline" className={cn("shrink-0", TYPE_META[seed.type ?? ""]?.className)}>
                      {typeLabel(seed.type)}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(open ? null : key)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate" title={seed.text}>
                        {seed.text}
                      </span>
                      <ChevronDown
                        size={14}
                        className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="移除"
                      onClick={() => setManualSeeds(manualSeeds.filter((_, i) => i !== index))}
                    >
                      <X size={13} className="text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-1.5 border-t border-dashed border-border/60 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                      <p className="whitespace-pre-wrap break-words">
                        <span className="font-medium text-foreground">题干：</span>
                        {seed.text}
                      </p>
                      {seedOptions && (
                        <div className="space-y-0.5">
                          {Object.entries(seedOptions).map(([optKey, optValue]) => (
                            <p key={optKey} className="whitespace-pre-wrap break-words">
                              <span className="font-medium text-foreground">{optKey}.</span> {optValue}
                            </p>
                          ))}
                        </div>
                      )}
                      {(seed.answer ?? "").trim() && (
                        <p className="whitespace-pre-wrap break-words">
                          <span className="font-medium text-foreground">答案：</span>
                          {seed.answer}
                        </p>
                      )}
                      {(seed.analysis ?? "").trim() && (
                        <p className="whitespace-pre-wrap break-words">
                          <span className="font-medium text-foreground">解析：</span>
                          {seed.analysis}
                        </p>
                      )}
                      {!hasDetail && <p className="text-muted-foreground/70">（无答案与解析）</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-4 text-center text-xs text-muted-foreground">
          <Sparkles size={13} /> 还没有种子题，可跳过此步直接完成。
        </p>
      )}

      {/* 导入识别结果：按题型勾选 */}
      <Dialog open={recognizeOpen} onOpenChange={setRecognizeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择要作为种子的题目</DialogTitle>
            <DialogDescription>
              已识别 {recognized.length} 道题，默认全部作为种子题。取消勾选不想保留的题目即可。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {TYPE_ORDER.filter((type) => recognized.some((s) => s.type === type)).map((type) => (
              <div key={type}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{TYPE_META[type].label}</p>
                <div className="space-y-1.5">
                  {recognized.map((seed, index) => {
                    if (seed.type !== type) return null;
                    const open = recognizeExpanded.has(index);
                    const hasOptions = Boolean(seed.options && Object.keys(seed.options).length > 0);
                    const hasDetail = hasOptions || Boolean((seed.answer ?? "").trim()) || Boolean((seed.analysis ?? "").trim());
                    return (
                      <div key={index} className="rounded-md border border-border/70 text-xs hover:bg-muted/30">
                        <div className="flex items-start gap-2 px-2.5 py-2">
                          <Checkbox
                            checked={recognizeSel.has(index)}
                            onCheckedChange={() =>
                              setRecognizeSel((prev) => {
                                const next = new Set(prev);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                return next;
                              })
                            }
                            className="mt-0.5"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setRecognizeExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                return next;
                              })
                            }
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                          >
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-5">{seed.text}</span>
                            {hasDetail && (
                              <ChevronDown
                                size={14}
                                className={cn(
                                  "mt-0.5 shrink-0 text-muted-foreground transition-transform",
                                  open && "rotate-180",
                                )}
                              />
                            )}
                          </button>
                        </div>
                        {open && hasDetail && (
                          <div className="space-y-1 border-t border-dashed border-border/60 px-2.5 py-2 pl-8 text-[11px] leading-5 text-muted-foreground">
                            {hasOptions && (
                              <div className="space-y-0.5">
                                {Object.entries(seed.options ?? {}).map(([key, value]) => (
                                  <p key={key}>
                                    <span className="font-medium text-foreground">{key}.</span> {value}
                                  </p>
                                ))}
                              </div>
                            )}
                            {(seed.answer ?? "").trim() && (
                              <p>
                                <span className="font-medium text-foreground">答案：</span>
                                {seed.answer}
                              </p>
                            )}
                            {(seed.analysis ?? "").trim() && (
                              <p>
                                <span className="font-medium text-foreground">解析：</span>
                                {seed.analysis}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecognizeOpen(false)}>
              取消
            </Button>
            <Button onClick={confirmImport} disabled={recognizeSel.size === 0}>
              加入选中（{recognizeSel.size}）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 从题库选择：真·全屏选题（题型可改、知识点限定课程相关）。
          用 portal 到 body，避免被外层对话框的定位上下文裁剪。 */}
      {bankDialogOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex flex-col bg-background">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground">从题库选择种子题</p>
                <p className="text-sm text-muted-foreground">
                  勾选作为风格样本的题目；被选中的题会在题库列表标注所属技能。
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="关闭" onClick={() => setBankDialogOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <QuestionSelector
                selectedIds={bankDialogSel}
                onChange={setBankDialogSel}
                initialType={bankInitialType}
                knowledgePointOptions={courseKpOptions}
                restrictKnowledgePointsToOptions
                showSummary={false}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 px-6 py-4">
              <Button variant="outline" onClick={() => setBankDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={() => void confirmBank()} disabled={bankConfirming}>
                {bankConfirming ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                确定（{bankDialogSel.length}）
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
