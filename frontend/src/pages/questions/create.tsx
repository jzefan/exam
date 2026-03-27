import { useCreate, useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Plus, X, ChevronsUpDown, Check } from "lucide-react";
import type { IQuestionBank, ITag, QuestionType } from "../../types";
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
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { RichTextEditor, htmlToPlainText } from "@/components/ui/rich-text-editor";
import { TagSelector } from "@/components/ui/tag-selector";
import { cn } from "@/lib/utils";

type UIQuestionType = QuestionType | "single_choice" | "multi_choice";

const questionTypes: { value: UIQuestionType; label: string }[] = [
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

function toBackendType(uiType: UIQuestionType): QuestionType {
  if (uiType === "single_choice" || uiType === "multi_choice") return "choice";
  return uiType;
}

const difficulties = [
  { value: "1", label: "容易" },
  { value: "2", label: "较易" },
  { value: "3", label: "一般" },
  { value: "4", label: "较难" },
  { value: "5", label: "很难" },
];

interface OptionItem {
  key: string;
  value: string;
}

export function QuestionCreate() {
  const navigate = useNavigate();
  const { mutate, mutation } = useCreate();
  const isPending = mutation.isPending;

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

  const [questionBankId, setQuestionBankId] = useState<string>("");
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [uiType, setUiType] = useState<UIQuestionType>("single_choice");
  const type = toBackendType(uiType);
  const isMultiChoice = uiType === "multi_choice";
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [form, setForm] = useState({
    contentHtml: "",
    analysis: "",
    difficulty: "3",
    score: "10",
    answer: "",
  });
  const [options, setOptions] = useState<OptionItem[]>([
    { key: "A", value: "" },
    { key: "B", value: "" },
    { key: "C", value: "" },
    { key: "D", value: "" },
  ]);
  const [fillBlanks, setFillBlanks] = useState<string[]>([""]);

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
    setOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((o, i) => ({ ...o, key: String.fromCharCode(65 + i) }));
    });
    setSelectedAnswers((prev) => prev.filter((k) => k !== options[index].key));
  };

  const toggleSingleAnswer = (key: string) => {
    setSelectedAnswers([key]);
  };

  const toggleMultiAnswer = (key: string) => {
    setSelectedAnswers((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const buildAnswer = (): Record<string, unknown> => {
    if (type === "choice") {
      return isMultiChoice
        ? { correct: selectedAnswers }
        : { correct: selectedAnswers[0] ?? "" };
    }
    if (type === "true_false") return { correct: form.answer === "true" };
    if (type === "fill_in") return { correct: fillBlanks };
    if (type === "short_answer" || type === "essay") {
      return { points: form.answer.split("\n").filter(Boolean) };
    }
    if (type === "code") return { code: form.answer };
    return { correct: form.answer };
  };

  const buildOptions = (): Record<string, string> | null => {
    if (type !== "choice") return null;
    const obj: Record<string, string> = {};
    for (const o of options) obj[o.key] = o.value;
    return obj;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const plainText = htmlToPlainText(form.contentHtml);
    mutate(
      {
        resource: "questions",
        values: {
          type,
          title: plainText,
          content: { html: form.contentHtml, text: plainText },
          options: buildOptions(),
          answer: buildAnswer(),
          analysis: form.analysis || null,
          difficulty: Number(form.difficulty),
          score: Number(form.score),
          question_bank_id: questionBankId || null,
          tag_ids: selectedTagIds,
          knowledge_point_ids: [],
        },
      },
      { onSuccess: () => navigate("/questions") },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          新建题目
        </h1>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          返回题目列表
        </button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Type + Difficulty + Question Bank */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>题型</Label>
                <Select
                  value={uiType}
                  onValueChange={(v) => {
                    setUiType(v as UIQuestionType);
                    setSelectedAnswers([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {questionTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>难度</Label>
                <Select
                  value={form.difficulty}
                  onValueChange={(v) => updateField("difficulty", v)}
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
              <div className="space-y-1.5">
                <Label>题库（可选）</Label>
                <Popover open={bankOpen} onOpenChange={setBankOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm ring-offset-background",
                        !questionBankId && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">
                        {questionBankId
                          ? banks.find((b) => b.id === questionBankId)?.name ?? "选择题库"
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
                              value={b.name}
                              onSelect={() => { setQuestionBankId(b.id); setBankOpen(false); }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", questionBankId === b.id ? "opacity-100" : "opacity-0")} />
                              {b.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-1.5">
              <Label>题目内容</Label>
              <RichTextEditor
                value={form.contentHtml}
                onChange={(html) => updateField("contentHtml", html)}
                placeholder="输入题目内容..."
              />
            </div>

            {/* Choice options with inline answer selection */}
            {type === "choice" && (
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
                        onChange={(e) => updateOption(i, e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => isMultiChoice ? toggleMultiAnswer(opt.key) : toggleSingleAnswer(opt.key)}
                        className={cn(
                          "inline-flex items-center gap-1 shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
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
                    onClick={addOption}
                  >
                    <Plus size={14} className="mr-1" />
                    添加选项
                  </Button>
                )}
              </div>
            )}

            {/* Answer — non-choice types only */}
            {type !== "choice" && (
              <div className="space-y-1.5">
                <Label>
                  {type === "true_false"
                    ? "正确答案"
                    : type === "fill_in"
                      ? "填空答案"
                      : type === "code"
                        ? "参考代码"
                        : "答案要点（每行一个）"}
                </Label>
                {type === "true_false" ? (
                  <Select
                    value={form.answer}
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
                      onClick={() => setFillBlanks((prev) => [...prev, ""])}
                    >
                      <Plus size={14} className="mr-1" />
                      添加空
                    </Button>
                  </div>
                ) : (
                  <Textarea
                    placeholder={
                      type === "code" ? "输入参考代码..." : "每行一个答案要点..."
                    }
                    rows={4}
                    value={form.answer}
                    onChange={(e) => updateField("answer", e.target.value)}
                    required
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
                onChange={(e) => updateField("score", e.target.value)}
                required
              />
            </div>

            {/* Analysis */}
            <div className="space-y-1.5">
              <Label>解析（可选）</Label>
              <RichTextEditor
                value={form.analysis}
                onChange={(html) => updateField("analysis", html)}
                placeholder="输入题目解析..."
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label>标签（可选）</Label>
              <TagSelector
                allTags={allTags}
                selectedTagIds={selectedTagIds}
                onChange={setSelectedTagIds}
              />
            </div>

            <Separator />

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    创建中...
                  </span>
                ) : (
                  "创建题目"
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                取消
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
