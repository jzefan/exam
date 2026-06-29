import { useGetIdentity, useOne, useUpdate, useList } from "@refinedev/core";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Plus, X, ChevronsUpDown, Check, AlertTriangle } from "lucide-react";
import type { IKnowledgePoint, IQuestion, IQuestionBank, ITag, QuestionType } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { RichTextEditor, htmlToPlainText } from "@/components/ui/rich-text-editor";
import { TagSelector } from "@/components/ui/tag-selector";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatQuestionBankLabel } from "@/lib/question-banks";
import { getUserRole } from "@/types/rbac";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import {
  buildCodeQuestionContent,
  extractCodeQuestionDetails,
  type CodeQuestionMode,
} from "./code-question-mode";

const difficulties = [
  { value: "1", label: "容易" },
  { value: "2", label: "较易" },
  { value: "3", label: "中等" },
  { value: "4", label: "较难" },
  { value: "5", label: "很难" },
];

interface OptionItem {
  key: string;
  value: string;
}

function extractFillBlanks(question: IQuestion): string[] {
  if (question.type !== "fill_in") return [""];
  const correct = question.answer?.correct;
  if (Array.isArray(correct)) return correct.length > 0 ? correct.map(String) : [""];
  if (typeof correct === "string" && correct) return [correct];
  // Legacy format: answer stored as {text: "val1, val2, ..."} instead of {correct: [...]}
  const text = question.answer?.text;
  if (typeof text === "string" && text) {
    const contentText = typeof question.content === "object" && question.content !== null
      ? String((question.content as Record<string, unknown>).text ?? "")
      : "";
    const blankCount = (contentText.match(/_{4,}/g) ?? []).length;
    const parts = text.split(/,\s*/);
    if (blankCount > 1 && parts.length === blankCount) return parts;
    return [text];
  }
  return [""];
}

function extractNonChoiceAnswer(question: IQuestion): string {
  const a = question.answer;
  if (question.type === "true_false") return a.correct === true ? "true" : "false";
  if (question.type === "fill_in") return ""; // handled by fillBlanks state
  if (question.type === "short_answer" || question.type === "essay") {
    const pts = (a.points ?? a.key_points) as string[] | undefined;
    if (pts?.length) return pts.join("\n");
    if (typeof a.text === "string") return a.text;
    if (typeof a.correct === "string") return a.correct;
    return "";
  }
  if (question.type === "code") {
    return String(a.code ?? a.text ?? a.correct ?? "");
  }
  return "";
}

// 简答/论述题的答案支持富文本（含图片），单独以 HTML 维护。
function escapeAnswerHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pointsToAnswerHtml(points: string[]): string {
  return points
    .map((point) => point.trim())
    .filter(Boolean)
    .map((point) => `<p>${escapeAnswerHtml(point)}</p>`)
    .join("");
}

// 把答案 HTML 还原成逐行的纯文本要点（textContent 不保留块级换行，需先把块标签转成换行）。
function answerHtmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const el = document.createElement("div");
  el.innerHTML = withBreaks;
  return (el.textContent ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractAnswerHtml(question: IQuestion): string {
  if (question.type !== "short_answer" && question.type !== "essay") return "";
  const a = question.answer ?? {};
  if (typeof a.html === "string" && a.html.trim()) return a.html;
  const pts = (a.points ?? a.key_points) as string[] | undefined;
  if (pts?.length) return pointsToAnswerHtml(pts);
  if (typeof a.text === "string" && a.text) return pointsToAnswerHtml(a.text.split("\n"));
  if (typeof a.correct === "string" && a.correct) return pointsToAnswerHtml([a.correct]);
  return "";
}

function extractSelectedAnswers(question: IQuestion): string[] {
  if (question.type !== "choice") return [];
  const correct = question.answer?.correct;
  if (Array.isArray(correct)) return correct as string[];
  if (typeof correct === "string" && correct) return [correct];
  return [];
}

function extractOptions(question: IQuestion): OptionItem[] {
  if (question.type !== "choice" || !question.options) {
    return [
      { key: "A", value: "" },
      { key: "B", value: "" },
      { key: "C", value: "" },
      { key: "D", value: "" },
    ];
  }
  const opts = question.options as Record<string, string>;
  return Object.entries(opts).map(([key, value]) => ({ key, value }));
}

function extractContentHtml(question: IQuestion): string {
  if (question.content && typeof question.content === "object") {
    const c = question.content as Record<string, unknown>;
    if (typeof c.html === "string" && c.html) return c.html;
    if (typeof c.text === "string" && c.text) return `<p>${c.text}</p>`;
  }
  if (question.title) return `<p>${question.title}</p>`;
  return "";
}

const questionTypeLabel: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

type UIQuestionType = QuestionType | "single_choice" | "multi_choice";

const questionTypeOptions: Array<{ value: UIQuestionType; label: string }> = [
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

function toBackendQuestionType(uiType: UIQuestionType): QuestionType {
  if (uiType === "single_choice" || uiType === "multi_choice") return "choice";
  return uiType;
}

function getInitialUiQuestionType(question: IQuestion): UIQuestionType {
  if (question.type === "choice") {
    return Array.isArray(question.answer?.correct) ? "multi_choice" : "single_choice";
  }
  return question.type;
}

function getUiQuestionTypeLabel(uiType: UIQuestionType): string {
  return questionTypeOptions.find((item) => item.value === uiType)?.label ?? "未知题型";
}

function getQuestionTypeDisplay(question: IQuestion): string {
  if (question.type === "choice") {
    return Array.isArray(question.answer?.correct) ? "多选题" : "单选题";
  }
  return questionTypeLabel[question.type];
}

export interface QuestionEditSubmitValues {
  type: QuestionType;
  title: string;
  content: Record<string, unknown>;
  options: Record<string, string> | null;
  answer: Record<string, unknown>;
  analysis: string | null;
  difficulty: number;
  score: number;
  question_bank_id: string | null;
  tag_ids: string[];
  knowledge_point_ids: string[];
}

interface QuestionEditFormContentProps {
  question: IQuestion;
  banks: IQuestionBank[];
  allTags: ITag[];
  knowledgePoints: IKnowledgePoint[];
  onSubmit: (values: QuestionEditSubmitValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  showHeader?: boolean;
  showQuestionBankAndTags?: boolean;
  allowTypeChange?: boolean;
  variant?: "page" | "dialog";
}

export function QuestionEditFormContent({
  question,
  banks,
  allTags,
  knowledgePoints,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = "保存修改",
  cancelLabel = "取消",
  showHeader = true,
  showQuestionBankAndTags = true,
  allowTypeChange = true,
  variant = "page",
}: QuestionEditFormContentProps) {
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name?: string } | null }>();
  const showBankOwner = identity ? getUserRole(identity) === "platform_admin" : false;
  const originalUiType = getInitialUiQuestionType(question);
  const [uiType, setUiType] = useState<UIQuestionType>(originalUiType);
  const [pendingUiType, setPendingUiType] = useState<UIQuestionType | null>(null);
  const type = toBackendQuestionType(uiType);
  const isChoice = type === "choice";
  const isMultiChoice = uiType === "multi_choice";

  const [questionBankId, setQuestionBankId] = useState<string>(question.question_bank_id ?? "");
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(question.tags?.map((t) => t.id) ?? []);
  const [selectedKnowledgePoints, setSelectedKnowledgePoints] = useState<SelectedKnowledgePoint[]>(
    question.knowledge_points?.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.name,
    })) ?? [],
  );
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>(extractSelectedAnswers(question));
  const [options, setOptions] = useState<OptionItem[]>(extractOptions(question));
  const [fillBlanks, setFillBlanks] = useState<string[]>(extractFillBlanks(question));
  const [codeDetails, setCodeDetails] = useState(() => extractCodeQuestionDetails(question.content));
  const [form, setForm] = useState({
    contentHtml: extractContentHtml(question),
    analysis: question.analysis ?? "",
    difficulty: String(question.difficulty),
    score: String(question.score),
    answer: extractNonChoiceAnswer(question),
  });
  // 简答/论述题答案的富文本（含图片）HTML，独立于 form.answer 维护。
  const [answerHtml, setAnswerHtml] = useState(() => extractAnswerHtml(question));
  const editLock = question.edit_lock ?? null;
  const isInUse = Boolean(editLock?.in_use);
  const canEditDifficulty = !isInUse || editLock?.allowed_fields.includes("difficulty");
  const canEditKnowledgePoints = !isInUse || editLock?.allowed_fields.includes("knowledge_point_ids");
  const canEditAnalysis = !isInUse || editLock?.allowed_fields.includes("analysis");
  const canEditAnswer = !isInUse || editLock?.allowed_fields.includes("answer");
  const canEditCodeTestCases = !isInUse || editLock?.allowed_fields.includes("code_test_cases");
  const isStructureLocked = isInUse;

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, value } : o)));
  };

  const addOption = () => {
    const nextKey = String.fromCharCode(65 + options.length);
    setOptions((prev) => [...prev, { key: nextKey, value: "" }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    const removedKey = options[index].key;
    setOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((o, i) => ({ ...o, key: String.fromCharCode(65 + i) }));
    });
    setSelectedAnswers((prev) => prev.filter((k) => k !== removedKey));
  };

  const toggleSingleAnswer = (key: string) => setSelectedAnswers([key]);
  const toggleMultiAnswer = (key: string) => {
    setSelectedAnswers((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const buildAnswer = (): Record<string, unknown> => {
    if (isChoice) {
      return isMultiChoice
        ? { correct: selectedAnswers }
        : { correct: selectedAnswers[0] ?? "" };
    }
    if (type === "true_false") return { correct: form.answer === "true" };
    if (type === "fill_in") return { correct: fillBlanks };
    if (type === "short_answer" || type === "essay") {
      const lines = answerHtmlToLines(answerHtml);
      // 保留 points/text 供评分与纯文本展示，html 携带富文本与图片。
      return { points: lines, text: lines.join("\n"), html: answerHtml };
    }
    if (type === "code") return { code: form.answer };
    return { correct: form.answer };
  };

  const buildContent = () => {
    const plainText = htmlToPlainText(form.contentHtml);
    if (type === "code") {
      return buildCodeQuestionContent({
        contentHtml: form.contentHtml,
        plainText,
        details: codeDetails,
      });
    }

    return { html: form.contentHtml, text: plainText };
  };

  const buildOptions = (): Record<string, string> | null => {
    if (!isChoice) return null;
    const obj: Record<string, string> = {};
    for (const o of options) obj[o.key] = o.value;
    return obj;
  };

  const requestTypeChange = (value: string) => {
    const nextUiType = value as UIQuestionType;
    if (nextUiType === uiType) return;
    setPendingUiType(nextUiType);
  };

  const applyTypeChange = () => {
    if (!pendingUiType) return;

    const previousType = type;
    const nextType = toBackendQuestionType(pendingUiType);
    setUiType(pendingUiType);

    if (nextType === "choice") {
      setOptions((prev) =>
        prev.length >= 2
          ? prev
          : [
              { key: "A", value: "" },
              { key: "B", value: "" },
              { key: "C", value: "" },
              { key: "D", value: "" },
            ],
      );
      setSelectedAnswers((prev) => {
        const next = prev.length > 0 ? prev : ["A"];
        return pendingUiType === "multi_choice" ? next : [next[0]];
      });
      updateField("answer", "");
    } else if (nextType === "true_false") {
      updateField("answer", "true");
    } else if (nextType === "fill_in") {
      setFillBlanks([""]);
    } else if (previousType === "fill_in") {
      updateField("answer", fillBlanks.filter(Boolean).join("\n"));
    } else if (previousType === "choice" || previousType === "true_false") {
      updateField("answer", "");
    }

    // 切换到简答/论述题时，用当前纯文本答案播种富文本编辑器。
    if (nextType === "short_answer" || nextType === "essay") {
      setAnswerHtml((prev) =>
        prev.trim() ? prev : pointsToAnswerHtml(form.answer.split("\n")),
      );
    }

    setPendingUiType(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const plainText = htmlToPlainText(form.contentHtml);
    onSubmit({
      type,
      title: plainText,
      content: buildContent(),
      options: buildOptions(),
      answer: buildAnswer(),
      analysis: form.analysis || null,
      difficulty: Number(form.difficulty),
      score: Number(form.score),
      question_bank_id: questionBankId || null,
      tag_ids: selectedTagIds,
      knowledge_point_ids: selectedKnowledgePoints.map((item) => item.id),
    });
  };

  return (
    <div className={cn("w-full", variant === "page" && "mx-auto max-w-[900px]")}>
      {showHeader ? (
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-base font-bold text-foreground tracking-tight">
            编辑题目
          </h1>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            返回题目列表
          </button>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {isInUse ? (
              <Alert className="border-amber-200 bg-amber-50/80 text-amber-950">
                <div className="flex gap-3">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div className="min-w-0">
                    <AlertTitle>题目内容已锁定</AlertTitle>
                    <AlertDescription className="space-y-1">
                      <p>这道题已有学生提交过答卷，题目内容已锁定。你仍可修改答案、解析、难度、知识点标签和编程题测试用例。</p>
                      {editLock?.has_submitted_attempts ? (
                        <p>修改答案或编程题测试用例后，系统会自动重新评分受影响的已提交答卷。</p>
                      ) : null}
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            ) : null}

            {/* Type + Difficulty + Question Bank */}
            <div className={cn("grid gap-4", showQuestionBankAndTags ? "grid-cols-3" : "grid-cols-2")}>
              <div className="space-y-1.5">
                <Label>题型</Label>
                {allowTypeChange ? (
                  <Select
                    value={uiType}
                    onValueChange={requestTypeChange}
                    disabled={isStructureLocked}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择题型" />
                    </SelectTrigger>
                    <SelectContent>
                      {questionTypeOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    {getQuestionTypeDisplay(question)}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>难度</Label>
                <Select
                  value={form.difficulty}
                  onValueChange={(v) => updateField("difficulty", v)}
                  disabled={!canEditDifficulty}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {difficulties.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showQuestionBankAndTags ? (
                <div className="space-y-1.5">
                <Label>题库（可选）</Label>
                <Popover open={bankOpen} onOpenChange={setBankOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm ring-offset-background",
                        isStructureLocked && "cursor-not-allowed opacity-60",
                        !questionBankId && "text-muted-foreground",
                      )}
                      disabled={isStructureLocked}
                    >
                      <span className="truncate">
                        {questionBankId
                          ? (() => {
                              const selectedBank = banks.find((b) => b.id === questionBankId);
                              return selectedBank
                                ? formatQuestionBankLabel(selectedBank, { showOwner: showBankOwner })
                                : "选择题库";
                            })()
                          : "选择题库"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="搜索题库..." />
                      <CommandList>
                        <CommandEmpty>未找到题库</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__none__"
                            onSelect={() => { setQuestionBankId(""); setBankOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", !questionBankId ? "opacity-100" : "opacity-0")} />
                            不选择题库
                          </CommandItem>
                          {banks.map((b) => (
                            <CommandItem
                              key={b.id}
                              value={formatQuestionBankLabel(b, { showOwner: showBankOwner })}
                              onSelect={() => { setQuestionBankId(b.id); setBankOpen(false); }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", questionBankId === b.id ? "opacity-100" : "opacity-0")} />
                              {formatQuestionBankLabel(b, { showOwner: showBankOwner })}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                </div>
              ) : null}
            </div>

            {uiType !== originalUiType ? (
              <Alert className="border-blue-200 bg-blue-50/80 text-blue-950">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>题型已调整</AlertTitle>
                <AlertDescription>
                  已从「{getQuestionTypeDisplay(question)}」改为「{getUiQuestionTypeLabel(uiType)}」。
                  请重新核对选项、答案、解析和分值，保存后才会正式生效。
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Content */}
            <div className="space-y-1.5">
              <Label>题目内容</Label>
              <div className="relative">
                <RichTextEditor
                  value={form.contentHtml}
                  onChange={(html) => updateField("contentHtml", html)}
                  placeholder="输入题目内容..."
                />
                {isStructureLocked ? (
                  <div
                    className="absolute inset-0 z-10 cursor-not-allowed rounded-md bg-transparent"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </div>

            {type === "code" && (
              <div className="space-y-5 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5 md:col-span-1">
                    <Label>作答模式</Label>
                    <Select
                      value={codeDetails.mode}
                      disabled={isStructureLocked}
                      onValueChange={(value) => {
                        setCodeDetails((prev) => ({
                          ...prev,
                          mode: value as CodeQuestionMode,
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="program">完整程序题（推荐）</SelectItem>
                        <SelectItem value="function">函数题（高级）</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm leading-6 text-muted-foreground">
                    {codeDetails.mode === "program"
                      ? "学生将编写完整程序，系统按输入与期望输出进行运行和判定。"
                      : "仅在确实需要考察函数实现逻辑时使用函数题高级模式。"}
                  </div>
                </div>

                {codeDetails.mode === "program" ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="code-input-description">输入说明</Label>
                        <Textarea
                          id="code-input-description"
                          rows={3}
                          value={codeDetails.inputDescription}
                          disabled={isStructureLocked}
                          onChange={(e) =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              inputDescription: e.target.value,
                            }))
                          }
                          placeholder="例如：输入一行，包含两个整数 a 和 b。"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="code-output-description">输出说明</Label>
                        <Textarea
                          id="code-output-description"
                          rows={3}
                          value={codeDetails.outputDescription}
                          disabled={isStructureLocked}
                          onChange={(e) =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              outputDescription: e.target.value,
                            }))
                          }
                          placeholder="例如：输出一个整数，表示 a+b。"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>示例输入输出</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isStructureLocked}
                          onClick={() =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              examples: [...prev.examples, { input: "", output: "", explanation: "" }],
                            }))
                          }
                        >
                          <Plus size={14} className="mr-1" />
                          添加示例
                        </Button>
                      </div>
                      {codeDetails.examples.map((item, index) => (
                        <div key={`example-${index}`} className="grid gap-3 rounded-xl border border-border/70 bg-background p-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`example-input-${index}`}>示例输入 {index + 1}</Label>
                            <Textarea
                              id={`example-input-${index}`}
                              rows={3}
                              value={item.input}
                              disabled={isStructureLocked}
                              onChange={(e) =>
                                setCodeDetails((prev) => ({
                                  ...prev,
                                  examples: prev.examples.map((example, exampleIndex) =>
                                    exampleIndex === index ? { ...example, input: e.target.value } : example,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`example-output-${index}`}>示例输出 {index + 1}</Label>
                            <Textarea
                              id={`example-output-${index}`}
                              rows={3}
                              value={item.output}
                              disabled={isStructureLocked}
                              onChange={(e) =>
                                setCodeDetails((prev) => ({
                                  ...prev,
                                  examples: prev.examples.map((example, exampleIndex) =>
                                    exampleIndex === index ? { ...example, output: e.target.value } : example,
                                  ),
                                }))
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>运行测试用例</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canEditCodeTestCases}
                          onClick={() =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              sampleTests: [...prev.sampleTests, { input: "", expectedOutput: "" }],
                            }))
                          }
                        >
                          <Plus size={14} className="mr-1" />
                          添加测试
                        </Button>
                      </div>
                      {codeDetails.sampleTests.map((item, index) => (
                        <div key={`sample-test-${index}`} className="grid gap-3 rounded-xl border border-border/70 bg-background p-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`sample-test-input-${index}`}>测试输入 {index + 1}</Label>
                            <Textarea
                              id={`sample-test-input-${index}`}
                              rows={3}
                              value={item.input}
                              disabled={!canEditCodeTestCases}
                              onChange={(e) =>
                                setCodeDetails((prev) => ({
                                  ...prev,
                                  sampleTests: prev.sampleTests.map((sample, sampleIndex) =>
                                    sampleIndex === index ? { ...sample, input: e.target.value } : sample,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`sample-test-output-${index}`}>期望输出 {index + 1}</Label>
                            <Textarea
                              id={`sample-test-output-${index}`}
                              rows={3}
                              value={item.expectedOutput}
                              disabled={!canEditCodeTestCases}
                              onChange={(e) =>
                                setCodeDetails((prev) => ({
                                  ...prev,
                                  sampleTests: prev.sampleTests.map((sample, sampleIndex) =>
                                    sampleIndex === index ? { ...sample, expectedOutput: e.target.value } : sample,
                                  ),
                                }))
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="code-function-name">函数名</Label>
                      <Input
                        id="code-function-name"
                        value={codeDetails.functionName}
                        disabled={isStructureLocked}
                        onChange={(e) =>
                          setCodeDetails((prev) => ({
                            ...prev,
                            functionName: e.target.value,
                          }))
                        }
                        placeholder="例如：twoSum"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="code-return-type">返回值类型</Label>
                      <Input
                        id="code-return-type"
                        value={codeDetails.returnType}
                        disabled={isStructureLocked}
                        onChange={(e) =>
                          setCodeDetails((prev) => ({
                            ...prev,
                            returnType: e.target.value,
                          }))
                        }
                        placeholder="例如：int[]"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="code-signature">函数签名</Label>
                      <Textarea
                        id="code-signature"
                        rows={3}
                        value={codeDetails.signature}
                        disabled={isStructureLocked}
                        onChange={(e) =>
                          setCodeDetails((prev) => ({
                            ...prev,
                            signature: e.target.value,
                          }))
                        }
                        placeholder="例如：twoSum(nums: int[], target: int) -> int[]"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="code-parameters">参数定义（每行一个，name: type）</Label>
                      <Textarea
                        id="code-parameters"
                        rows={4}
                        value={codeDetails.parametersText}
                        disabled={isStructureLocked}
                        onChange={(e) =>
                          setCodeDetails((prev) => ({
                            ...prev,
                            parametersText: e.target.value,
                          }))
                        }
                        placeholder={"例如：\nnums: int[]\ntarget: int"}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Choice options with inline answer selection */}
            {isChoice && (
              <div className="space-y-2">
                <Label>选项</Label>
                {options.map((opt, i) => {
                  const isCorrect = selectedAnswers.includes(opt.key);
                  return (
                    <div key={opt.key} className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground w-5 shrink-0">
                        {opt.key}.
                      </span>
                      <Input
                        className="flex-1"
                        placeholder={`选项 ${opt.key}`}
                        value={opt.value}
                        disabled={isStructureLocked}
                        onChange={(e) => updateOption(i, e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        disabled={!canEditAnswer}
                        onClick={() => isMultiChoice ? toggleMultiAnswer(opt.key) : toggleSingleAnswer(opt.key)}
                        className={cn(
                          "inline-flex items-center gap-1 shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                          !canEditAnswer && "cursor-not-allowed opacity-60",
                          isCorrect
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        设为答案
                      </button>
                      {options.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-500"
                          disabled={isStructureLocked}
                          onClick={() => removeOption(i)}
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  );
                })}
                {options.length < 8 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isStructureLocked}
                    onClick={addOption}
                  >
                    <Plus size={14} className="mr-1" />
                    添加选项
                  </Button>
                )}
              </div>
            )}

            {/* Answer — non-choice only */}
            {!isChoice && (
              <div className="space-y-1.5">
                <Label>
                  {type === "true_false"
                    ? "正确答案"
                    : type === "fill_in"
                      ? "填空答案"
                      : type === "code"
                        ? "参考答案代码（可选）"
                        : "答案要点（每行一个，可插入图片）"}
                </Label>
                {type === "true_false" ? (
                  <Select
                    value={form.answer}
                    disabled={!canEditAnswer}
                    onValueChange={(v) => updateField("answer", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择答案" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">正确</SelectItem>
                      <SelectItem value="false">错误</SelectItem>
                    </SelectContent>
                  </Select>
                ) : type === "fill_in" ? (
                  <div className="space-y-2">
                    {fillBlanks.map((blank, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground shrink-0">
                          空{i + 1}.
                        </span>
                        <Input
                          className="flex-1"
                          placeholder={`第 ${i + 1} 空的答案`}
                          value={blank}
                          disabled={!canEditAnswer}
                          onChange={(e) =>
                            setFillBlanks((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                          }
                          required
                        />
                        {fillBlanks.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-500"
                            disabled={!canEditAnswer}
                            onClick={() => setFillBlanks((prev) => prev.filter((_, j) => j !== i))}
                          >
                            <X size={14} />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canEditAnswer}
                      onClick={() => setFillBlanks((prev) => [...prev, ""])}
                    >
                      <Plus size={14} className="mr-1" />
                      添加空
                    </Button>
                  </div>
                ) : type === "code" ? (
                  <Textarea
                    placeholder="输入参考答案代码（可选）..."
                    rows={4}
                    value={form.answer}
                    disabled={!canEditAnswer}
                    onChange={(e) => updateField("answer", e.target.value)}
                  />
                ) : canEditAnswer ? (
                  <RichTextEditor
                    value={answerHtml}
                    onChange={setAnswerHtml}
                    placeholder="每行一个答案要点，可插入图片..."
                  />
                ) : (
                  <Textarea
                    rows={4}
                    value={answerHtmlToLines(answerHtml).join("\n")}
                    disabled
                  />
                )}
              </div>
            )}

            {/* Score */}
            <div className="space-y-1.5">
              <Label>分值</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                className="w-32"
                value={form.score}
                disabled={isStructureLocked}
                onChange={(e) => updateField("score", e.target.value)}
                required
              />
            </div>

            {/* Analysis */}
            <div className="space-y-1.5">
              <Label>解析（可选）</Label>
              <div className="relative">
                <RichTextEditor
                  value={form.analysis}
                  onChange={(html) => updateField("analysis", html)}
                  placeholder="输入题目解析..."
                />
                {!canEditAnalysis ? (
                  <div
                    className="absolute inset-0 z-10 cursor-not-allowed rounded-md bg-transparent"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </div>

            {showQuestionBankAndTags ? (
              <>
                <div className="space-y-1.5">
                  <Label>知识点（可选）</Label>
                  <div className={cn(!canEditKnowledgePoints && "pointer-events-none opacity-60")}>
                    <KnowledgePointSelector
                      fetcher={(path, init) =>
                        apiClient
                          .get(`/api${path}`, { signal: init?.signal as AbortSignal | undefined })
                          .then((response) => response.data)
                      }
                      selectedKnowledgePoints={selectedKnowledgePoints}
                      onSelectedKnowledgePointsChange={setSelectedKnowledgePoints}
                      label=""
                      triggerLabel={knowledgePoints.length > 0 ? "选择知识点" : "暂无可选知识点"}
                      showUsageShortcuts={false}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>标签（可选）</Label>
                  <div className={cn(isStructureLocked && "pointer-events-none opacity-60")}>
                    <TagSelector
                      allTags={allTags}
                      selectedTagIds={selectedTagIds}
                      onChange={setSelectedTagIds}
                    />
                  </div>
                </div>
              </>
            ) : null}

            <Separator />

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    保存中...
                  </span>
                ) : (
                  submitLabel
                )}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(pendingUiType)}
        onOpenChange={(open) => {
          if (!open) setPendingUiType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认修改题型？</AlertDialogTitle>
            <AlertDialogDescription>
              将题型从「{getUiQuestionTypeLabel(uiType)}」改为「{pendingUiType ? getUiQuestionTypeLabel(pendingUiType) : ""}」后，答案、选项或代码题配置的编辑方式会随之变化。
              原有答案可能不再适配新题型，请确认后重新核对。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={applyTypeChange}>确认修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface QuestionEditFormProps {
  question: IQuestion;
  banks: IQuestionBank[];
  allTags: ITag[];
  knowledgePoints: IKnowledgePoint[];
  id: string;
  backTo?: string;
}

function QuestionEditForm({ question, banks, allTags, knowledgePoints, id, backTo }: QuestionEditFormProps) {
  const navigate = useNavigate();
  const { mutate, mutation } = useUpdate();
  const { toast } = useToast();
  const goBack = () => {
    if (backTo) {
      navigate(backTo);
      return;
    }
    navigate(-1);
  };

  return (
    <QuestionEditFormContent
      question={question}
      banks={banks}
      allTags={allTags}
      knowledgePoints={knowledgePoints}
      isSubmitting={mutation.isPending}
      onCancel={goBack}
      onSubmit={(values) => {
        const originalCodeDetails = question.type === "code" ? extractCodeQuestionDetails(question.content) : null;
        const nextCodeDetails = question.type === "code" ? extractCodeQuestionDetails(values.content) : null;
        const willTriggerRegrade = Boolean(
          question.edit_lock?.has_submitted_attempts &&
            (
              JSON.stringify(question.answer ?? {}) !== JSON.stringify(values.answer ?? {}) ||
              (
                question.type === "code" &&
                JSON.stringify(originalCodeDetails?.sampleTests ?? []) !==
                  JSON.stringify(nextCodeDetails?.sampleTests ?? [])
              )
            ),
        );

        mutate(
          {
            resource: "questions",
            id,
            values,
          },
          {
            onSuccess: () => {
              if (willTriggerRegrade) {
                toast({
                  title: "已保存题目修改",
                  description: "系统正在重新评分受影响的已提交答卷。",
                });
              }
              navigate(backTo ?? "/questions");
            },
          },
        );
      }}
    />
  );
}

export function QuestionEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { backTo?: string } | null;
  const backTo = navState?.backTo;

  const { query: oneQuery } = useOne<IQuestion>({
    resource: "questions",
    id: id!,
  });
  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const { query: tagsQuery } = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const allTags = tagsQuery.data?.data ?? [];
  const { query: knowledgePointsQuery } = useList<IKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const knowledgePoints = knowledgePointsQuery.data?.data ?? [];

  if (oneQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const question = oneQuery.data?.data;

  if (!question) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        题目不存在
        <button className="ml-2 underline" onClick={() => navigate("/questions")}>
          返回列表
        </button>
      </div>
    );
  }

  return (
    <QuestionEditForm
      key={question.id}
      question={question}
      banks={banks}
      allTags={allTags}
      knowledgePoints={knowledgePoints}
      id={id!}
      backTo={backTo}
    />
  );
}
