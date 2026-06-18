import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  History,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  StopCircle,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AIGeneratedQuestionCard,
  type AIGeneratedQuestionPreview,
} from "@/components/questions/ai-generated-question-card";
import type { QuestionType } from "@/types";
import {
  deleteTemplate,
  duplicateTemplate,
  generateFromTemplate,
  kbStats,
  listCourseTemplates,
  listTemplateRuns,
  saveGeneratedToCourseBank,
  setDefaultTemplate,
  type KbStats,
} from "./api";
import { getTeacherCourse } from "@/pages/courses/api";
import { TemplateEditor } from "./template-editor";
import { ChatGenerate } from "./chat-generate";
import {
  hasCodeMissingAnswer,
  publishGenerated,
  type PublishTarget,
} from "./publish";
import type { RunSummary, TemplateSummary } from "./types";

type EditorState = { templateId: string | null } | null;

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "choice", label: "选择题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];
const DIFFICULTY_OPTIONS = [
  { value: "0", label: "跟随技能设置" },
  { value: "2", label: "简单" },
  { value: "3", label: "中等" },
  { value: "4", label: "偏难" },
];
const RUN_STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  completed: "完成",
  failed: "失败",
};

function answerText(answer: AIGeneratedQuestionPreview["answer"]): string {
  const raw = answer?.text ?? answer?.correct;
  if (Array.isArray(raw)) return raw.join("");
  return raw == null ? "" : String(raw).trim();
}

function normalizeStem(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、；：,.;:!?（）()"'`]/g, "");
}

function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  if (text.length < 3) {
    if (text) grams.add(text);
    return grams;
  }
  for (let i = 0; i <= text.length - 3; i += 1) grams.add(text.slice(i, i + 3));
  return grams;
}

/** Cheap near-duplicate check (trigram Jaccard) to flag the AI repeating itself. */
function isNearDuplicate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union > 0 && inter / union > 0.82;
}

function StepHeading({
  index,
  title,
  hint,
}: {
  index: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {index}
      </span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function QuestionGenTemplatesPage() {
  const { id: courseId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [skills, setSkills] = useState<TemplateSummary[]>([]);
  const [courseName, setCourseName] = useState("");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 出题方式：表单（逐项设置）/ 对话（自然语言驱动）。第一步选技能两者共用。
  const [mode, setMode] = useState<"form" | "chat">("form");

  // 本次出题要求（出题规则由老师每次填写，不再存在技能里）。
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({
    choice: 5,
  });
  const [overrideDifficulty, setOverrideDifficulty] = useState("0");
  const [extraPrompt, setExtraPrompt] = useState("");

  const [questions, setQuestions] = useState<AIGeneratedQuestionPreview[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [kb, setKb] = useState<KbStats | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const totalCount = useMemo(
    () =>
      Object.values(typeCounts).reduce(
        (sum, n) => sum + (Number.isFinite(n) ? n : 0),
        0,
      ),
    [typeCounts],
  );
  const selectedSkill = skills.find((s) => s.id === selectedSkillId) ?? null;

  const duplicateFlags = useMemo(() => {
    const flagged = new Set<number>();
    const norms = questions.map((q) =>
      normalizeStem(q.content.text || q.title),
    );
    for (let i = 0; i < questions.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        if (isNearDuplicate(norms[i], norms[j])) {
          flagged.add(questions[i].index);
          break;
        }
      }
    }
    return flagged;
  }, [questions]);

  const reload = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const rows = await listCourseTemplates(courseId);
      setSkills(rows);
      // 引导：默认选中默认技能（或唯一技能）。
      setSelectedSkillId((current) => {
        if (current && rows.some((r) => r.id === current)) return current;
        return rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null;
      });
    } catch (error) {
      toast({
        title: "加载出题技能失败",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!courseId) return;
    kbStats(courseId)
      .then(setKb)
      .catch(() => setKb(null));
    getTeacherCourse(courseId)
      .then((c) => setCourseName(c.name))
      .catch(() => undefined);
  }, [courseId]);

  // 从课程详情「创建出题技能」入口进入时，直接打开新建技能编辑器（一次性，避免刷新重开）。
  useEffect(() => {
    if ((location.state as { createSkill?: boolean } | null)?.createSkill) {
      setEditor({ templateId: null });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const runGenerate = useCallback(async () => {
    if (!selectedSkillId) {
      toast({ title: "请先选择一个出题技能", variant: "destructive" });
      return;
    }
    const distribution = Object.fromEntries(
      Object.entries(typeCounts).filter(([, n]) => n > 0),
    );
    if (Object.keys(distribution).length === 0) {
      toast({
        title: "请设置题型数量",
        description: "至少一种题型数量大于 0。",
        variant: "destructive",
      });
      return;
    }
    setQuestions([]);
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const difficulty =
      overrideDifficulty === "0" ? null : Number(overrideDifficulty);
    try {
      const response = await generateFromTemplate(
        selectedSkillId,
        {
          type_distribution: distribution,
          difficulty,
          extra_prompt: extraPrompt.trim() || undefined,
        },
        controller.signal,
      );
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail ?? `请求失败：${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let index = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            const next: AIGeneratedQuestionPreview = {
              index: index++,
              type: (event.data.type ?? "choice") as QuestionType,
              title: event.data.title ?? "",
              content: {
                text: event.data.content?.text ?? event.data.title ?? "",
              },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? 3,
              selected: true,
            };
            setQuestions((prev) => [...prev, next]);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "生成失败");
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast({
          title: "出题失败",
          description: String(error),
          variant: "destructive",
        });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
      listTemplateRuns(selectedSkillId)
        .then(setRuns)
        .catch(() => undefined);
    }
  }, [selectedSkillId, typeCounts, overrideDifficulty, extraPrompt, toast]);

  const removeQuestion = useCallback((index: number) => {
    setQuestions((prev) => prev.filter((q) => q.index !== index));
  }, []);

  const handleSetDefault = useCallback(
    async (templateId: string) => {
      setBusyId(templateId);
      try {
        await setDefaultTemplate(templateId);
        await reload();
      } catch (error) {
        toast({
          title: "操作失败",
          description: String(error),
          variant: "destructive",
        });
      } finally {
        setBusyId(null);
      }
    },
    [reload, toast],
  );

  const handleDuplicate = useCallback(
    async (templateId: string) => {
      setBusyId(templateId);
      try {
        const copy = await duplicateTemplate(templateId);
        await reload();
        toast({
          title: "已复制出题技能",
          description: `已创建《${copy.name}》，可继续编辑。`,
        });
        setEditor({ templateId: copy.id });
      } catch (error) {
        toast({
          title: "复制失败",
          description: String(error),
          variant: "destructive",
        });
      } finally {
        setBusyId(null);
      }
    },
    [reload, toast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTemplate(deleteTarget.id);
      if (selectedSkillId === deleteTarget.id) {
        setSelectedSkillId(null);
        setQuestions([]);
      }
      setDeleteTarget(null);
      await reload();
      toast({ title: "出题技能已删除" });
    } catch (error) {
      toast({
        title: "删除失败",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, selectedSkillId, reload, toast]);

  const handleSave = useCallback(async () => {
    if (!courseId || questions.length === 0) return;
    const codeMissing = questions.find(
      (q) => q.type === "code" && !answerText(q.answer),
    );
    if (codeMissing) {
      toast({
        title: "代码题缺少参考答案",
        description: "请删除或补充后再保存。",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = questions.map((q) => ({
        type: q.type,
        title: q.title,
        content: q.content,
        options: q.options,
        answer:
          q.type === "code"
            ? { ...q.answer, code: answerText(q.answer) }
            : q.answer,
        analysis: q.analysis,
        difficulty: q.difficulty,
        score: 10,
        tag_ids: [],
        knowledge_point_ids: [courseId],
      }));
      const result = await saveGeneratedToCourseBank(payload);
      toast({
        title: `已保存 ${result.created_question_ids?.length ?? questions.length} 道题到课程题库`,
      });
      setQuestions([]);
    } catch (error) {
      toast({
        title: "保存失败",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [courseId, questions, toast]);

  const handlePublish = useCallback(
    async (target: PublishTarget) => {
      if (!courseId || questions.length === 0) return;
      if (hasCodeMissingAnswer(questions)) {
        toast({
          title: "代码题缺少参考答案",
          description: "请删除或补充后再发布。",
          variant: "destructive",
        });
        return;
      }
      setSaving(true);
      try {
        await publishGenerated({ courseId, questions, target, navigate });
      } catch (error) {
        toast({
          title: "发布失败",
          description: String(error),
          variant: "destructive",
        });
        setSaving(false);
      }
    },
    [courseId, questions, navigate, toast],
  );

  if (!courseId) return null;

  const showWorkspace = !editor && !loading && skills.length > 0;
  const headerTitle = editor ? (editor.templateId ? "编辑出题技能" : "创建出题技能") : "智能出题";
  const headerDescription = editor
    ? "技能信息 → 教学目标 → 种子题，创建后即可用于智能出题。"
    : "选择出题技能 → 填写本次要求 → AI 基于课程知识库出题，确认后保存到课程题库。";
  const modeToggle = (
    <div className="flex h-9 w-fit rounded-lg border border-border/70 bg-muted p-0.5 text-sm">
      <button
        type="button"
        onClick={() => setMode("form")}
        className={cn(
          "flex h-full items-center rounded-md px-4 font-medium transition-colors",
          mode === "form"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        表单出题
      </button>
      <button
        type="button"
        onClick={() => setMode("chat")}
        className={cn(
          "flex h-full items-center gap-1 rounded-md px-4 font-medium transition-colors",
          mode === "chat"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Sparkles size={13} />
        对话出题
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageIntroHeader
        title={headerTitle}
        description={headerDescription}
        onBack={() => navigate(`/courses/${courseId}`)}
        backLabel="返回课程详情"
        actions={showWorkspace ? modeToggle : undefined}
      />

      {editor ? (
        <div className="mx-auto w-full max-w-[1200px]">
          <TemplateEditor
            courseId={courseId}
            templateId={editor.templateId}
            courseName={courseName}
            existingNames={skills.map((s) => s.name)}
            onSaved={() => {
              setEditor(null);
              void reload();
            }}
            onCancel={() => setEditor(null)}
          />
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中...
        </div>
      ) : skills.length === 0 ? (
        /* 尚无技能：居中展示引导创建 */
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
          <div className="space-y-3 text-center">
            <Wand2 size={40} className="mx-auto text-muted-foreground/50" />
            <p className="text-base font-semibold text-foreground">
              先创建你的第一个出题技能
            </p>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              出题技能 = 教学阶段 + 教学目标 + 种子题风格。
              <br />
              创建一次，之后每次出题直接复用，AI 基于课程知识库出题。
            </p>
          </div>
          <Button onClick={() => setEditor({ templateId: null })}>
            <Plus size={16} className="mr-1.5" />
            创建出题技能
          </Button>
          {kb ? (
            kb.chunk_count > 0 ? (
              <p className="text-xs text-muted-foreground">
                课程知识库：{kb.chunk_count} 个片段（{kb.ready_materials}{" "}
                份资料已入库）
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle size={12} className="shrink-0" />
                课程知识库为空，请先在「课程资料」上传 PDF/Word/PPT
              </p>
            )
          ) : null}
        </div>
      ) : (
        /* 已有技能：三步布局 */
        <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* 第一步：选择出题技能 */}
          <div className="space-y-4 self-start pr-6">
            <div className="flex h-9 items-center">
              <StepHeading index={1} title="选择出题技能" />
            </div>

            {skills.map((skill) => {
              const isSelected = selectedSkillId === skill.id;
              return (
                <Card
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={cn(
                    "group relative cursor-pointer transition-all",
                    isSelected
                      ? "border-primary ring-1 ring-primary/30"
                      : "hover:border-primary/40",
                  )}
                >
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-transparent",
                        )}
                      >
                        <Check size={12} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {skill.name}
                          </span>
                          {skill.is_default && (
                            <Badge
                              variant="outline"
                              className="shrink-0 whitespace-nowrap border-primary/30 text-primary"
                            >
                              默认
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {skill.seed_count} 道种子题
                        </p>
                      </div>
                    </div>
                    <div
                      className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border/70 bg-card/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!skill.is_default && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="设为默认"
                          title="设为默认技能"
                          disabled={busyId === skill.id}
                          onClick={() => void handleSetDefault(skill.id)}
                        >
                          <Star size={14} />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label="编辑"
                        title="编辑"
                        onClick={() => setEditor({ templateId: skill.id })}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label="复制"
                        title="复制为新技能"
                        disabled={busyId === skill.id}
                        onClick={() => void handleDuplicate(skill.id)}
                      >
                        {busyId === skill.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-destructive"
                        aria-label="删除"
                        title="删除"
                        onClick={() => setDeleteTarget(skill)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <button
              type="button"
              onClick={() => setEditor({ templateId: null })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
            >
              <Plus size={15} />
              新建技能
            </button>

            {kb ? (
              kb.chunk_count > 0 ? (
                <p className="text-xs text-muted-foreground">
                  课程知识库：{kb.chunk_count} 个片段（{kb.ready_materials}{" "}
                  份资料已入库）。出题基于知识库检索，覆盖全部知识点。
                </p>
              ) : (
                <p className="flex items-start gap-1 text-xs leading-5 text-amber-600">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  课程知识库为空：请先在「课程资料」上传
                  PDF/Word/PPT，资料会自动进入知识库。
                </p>
              )
            ) : null}
          </div>

          {/* 出题方式：表单 / 对话（切换在页面头部右侧） */}
          <div className="space-y-4 self-start border-l border-border/60 pl-6">
            {mode === "chat" ? (
              <div className="mx-auto w-full max-w-3xl">
                {selectedSkillId ? (
                  <ChatGenerate
                    skillId={selectedSkillId}
                    skillName={selectedSkill?.name ?? ""}
                    courseId={courseId}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
                    请先在左侧选择一个出题技能，再用对话出题。
                  </div>
                )}
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <StepHeading
                      index={2}
                      title="填写本次出题要求"
                      hint="每次出题时设置，不存入技能"
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        题型与数量
                      </Label>
                      <div className="grid grid-cols-3 gap-2">
                        {TYPE_OPTIONS.map((opt) => (
                          <div
                            key={opt.value}
                            className="flex items-center gap-1.5"
                          >
                            <span className="w-12 shrink-0 text-xs text-muted-foreground">
                              {opt.label}
                            </span>
                            <Input
                              type="number"
                              min={0}
                              max={20}
                              value={typeCounts[opt.value] ?? 0}
                              onChange={(e) =>
                                setTypeCounts((prev) => ({
                                  ...prev,
                                  [opt.value]: Math.max(
                                    0,
                                    parseInt(e.target.value, 10) || 0,
                                  ),
                                }))
                              }
                              className="h-8"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          本次难度
                        </Label>
                        <Select
                          value={overrideDifficulty}
                          onValueChange={setOverrideDifficulty}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DIFFICULTY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                          额外要求（可选）
                        </Label>
                        <Input
                          value={extraPrompt}
                          onChange={(e) => setExtraPrompt(e.target.value)}
                          placeholder="如：围绕第三章循环结构，多结合生活案例"
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {selectedSkill ? (
                          <>
                            使用技能
                            <span className="mx-0.5 font-medium text-foreground">
                              《{selectedSkill.name}》
                            </span>
                            出{" "}
                            <span className="font-medium text-foreground">
                              {totalCount}
                            </span>{" "}
                            道题
                          </>
                        ) : (
                          "请先在左侧选择一个出题技能"
                        )}
                      </p>
                      {generating ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => abortRef.current?.abort()}
                        >
                          <StopCircle size={14} className="mr-1" />
                          停止生成
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!selectedSkillId || totalCount === 0}
                          onClick={() => void runGenerate()}
                        >
                          <Sparkles size={14} className="mr-1" />
                          开始出题
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="min-h-[320px]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <StepHeading
                        index={3}
                        title="预览并保存"
                        hint="不满意的题可删除"
                      />
                      {questions.length > 0 && !generating && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleSave()}
                            disabled={saving}
                          >
                            {saving ? (
                              <Loader2
                                size={14}
                                className="mr-1 animate-spin"
                              />
                            ) : (
                              <Check size={14} className="mr-1" />
                            )}
                            保存 {questions.length} 题
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" disabled={saving}>
                                <Rocket size={14} className="mr-1" />
                                发布
                                <ChevronDown size={13} className="ml-1" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => void handlePublish("exam")}
                              >
                                <ClipboardList size={14} className="mr-2" />
                                发布为考试
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => void handlePublish("practice")}
                              >
                                <ListChecks size={14} className="mr-2" />
                                发布为作业
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {questions.length === 0 && !generating ? (
                      <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Sparkles size={32} className="opacity-40" />
                        <p className="text-sm">
                          生成的题目会显示在这里，确认后保存到课程题库
                        </p>
                      </div>
                    ) : (
                      <>
                        {questions.map((q) => (
                          <div key={q.index} className="space-y-1">
                            {duplicateFlags.has(q.index) && (
                              <div className="flex items-center gap-1 text-xs text-amber-600">
                                <AlertTriangle size={12} />
                                疑似与前面的题目重复，可删除
                              </div>
                            )}
                            <AIGeneratedQuestionCard
                              question={q}
                              onRemove={() => removeQuestion(q.index)}
                            />
                          </div>
                        ))}
                        {generating && (
                          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                            <Loader2 size={16} className="animate-spin" />
                            正在基于课程知识库出题...
                          </div>
                        )}
                      </>
                    )}

                    {runs.length > 0 && (
                      <div className="border-t border-border/60 pt-3">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setShowRuns((v) => !v)}
                        >
                          <History size={12} />
                          最近生成记录（{runs.length}）
                        </button>
                        {showRuns && (
                          <div className="mt-2 space-y-1">
                            {runs.map((run) => (
                              <div
                                key={run.id}
                                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                              >
                                <span className="truncate">
                                  {new Date(run.created_at).toLocaleString()}
                                </span>
                                <span className="shrink-0">
                                  {RUN_STATUS_LABEL[run.status] ?? run.status} ·{" "}
                                  {run.generated_count} 题
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除出题技能</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除出题技能《{deleteTarget?.name}
              》吗？技能中的教学目标与种子题配置将一并删除，
              已生成保存到题库的题目不受影响。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
