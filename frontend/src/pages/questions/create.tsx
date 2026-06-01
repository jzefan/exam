import { useCreate, useGetIdentity, useList } from "@refinedev/core";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { Plus, X, ChevronsUpDown, Check } from "lucide-react";
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
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { RichTextEditor, htmlToPlainText } from "@/components/ui/rich-text-editor";
import { TagSelector } from "@/components/ui/tag-selector";
import { formatQuestionBankLabel } from "@/lib/question-banks";
import { getUserRole } from "@/types/rbac";
import { cn } from "@/lib/utils";
import {
  buildCodeQuestionContent,
  createEmptyCodeQuestionDetails,
  type CodeQuestionMode,
} from "./code-question-mode";

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
  { value: "3", label: "中等" },
  { value: "4", label: "较难" },
  { value: "5", label: "很难" },
];

interface OptionItem {
  key: string;
  value: string;
}

export function QuestionCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
    successTo?: string;
    courseKpId?: string;
  };
  const { mutate, mutation } = useCreate();
  const isPending = mutation.isPending;
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name?: string } | null }>();
  const showBankOwner = identity ? getUserRole(identity) === "platform_admin" : false;

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
  const [codeDetails, setCodeDetails] = useState(createEmptyCodeQuestionDetails);

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
          content: buildContent(),
          options: buildOptions(),
          answer: buildAnswer(),
          analysis: form.analysis || null,
          difficulty: Number(form.difficulty),
          score: Number(form.score),
          question_bank_id: questionBankId || null,
          tag_ids: selectedTagIds,
          knowledge_point_ids: navState.courseKpId ? [navState.courseKpId] : [],
        },
      },
      { onSuccess: () => navigate(navState.successTo ?? "/questions") },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <PageIntroHeader
        title="创建题目"
        description="录入题干、答案、解析与标签，快速沉淀高质量题库资源。"
        onBack={() => navState.backTo ? navigate(navState.backTo) : navigate(-1)}
        backLabel={navState.backLabel ?? "返回题目列表"}
        fullBleed
        className="mb-6"
      />

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

            {type === "code" && (
              <div className="space-y-5 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5 md:col-span-1">
                    <Label>作答模式</Label>
                    <Select
                      value={codeDetails.mode}
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
                          aria-label="输入说明"
                          rows={3}
                          placeholder="例如：输入一行，包含两个整数 a 和 b。"
                          value={codeDetails.inputDescription}
                          onChange={(e) =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              inputDescription: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="code-output-description">输出说明</Label>
                        <Textarea
                          id="code-output-description"
                          aria-label="输出说明"
                          rows={3}
                          placeholder="例如：输出一个整数，表示 a+b。"
                          value={codeDetails.outputDescription}
                          onChange={(e) =>
                            setCodeDetails((prev) => ({
                              ...prev,
                              outputDescription: e.target.value,
                            }))
                          }
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
                              aria-label={`示例输入 ${index + 1}`}
                              rows={3}
                              value={item.input}
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
                              aria-label={`示例输出 ${index + 1}`}
                              rows={3}
                              value={item.output}
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
                              aria-label={`测试输入 ${index + 1}`}
                              rows={3}
                              value={item.input}
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
                              aria-label={`期望输出 ${index + 1}`}
                              rows={3}
                              value={item.expectedOutput}
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
                        ? "参考答案代码（可选）"
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
                      type === "code" ? "输入参考答案代码（可选）..." : "每行一个答案要点..."
                    }
                    rows={4}
                    value={form.answer}
                    onChange={(e) => updateField("answer", e.target.value)}
                    required={type !== "code"}
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
              <Button type="button" variant="outline" onClick={() => navState.backTo ? navigate(navState.backTo) : navigate(-1)}>
                取消
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
