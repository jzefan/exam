import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileWarning,
  HelpCircle,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";

import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { IQuestion, QuestionType } from "@/types";
import type { QuestionImportDraft } from "../import-types";
import {
  buildAnswerPayload,
  getBlockingImportIssues,
  getQuestionTypeLabel,
  generateImportQuestionTitle,
  importTextToHtml,
  isMissingAnswerIssue,
} from "../import-utils";

type WorkspaceFilter = "all" | "issues" | "missing_answer" | "doubt" | QuestionType;

const typeFilterOptions: Array<{ value: QuestionType; label: string; dotClass: string }> = [
  { value: "choice", label: "选择题", dotClass: "bg-blue-500" },
  { value: "true_false", label: "判断题", dotClass: "bg-cyan-500" },
  { value: "fill_in", label: "填空题", dotClass: "bg-violet-500" },
  { value: "short_answer", label: "简答题", dotClass: "bg-emerald-500" },
  { value: "essay", label: "论述题", dotClass: "bg-pink-500" },
  { value: "code", label: "编程题", dotClass: "bg-amber-500" },
];

const editableTypeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: "choice", label: "选择题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

function hasMissingAnswer(draft: QuestionImportDraft) {
  return !draft.answer_text?.trim() || draft.issues.some(isMissingAnswerIssue);
}

function searchableText(draft: QuestionImportDraft) {
  return [
    draft.title,
    draft.content_text,
    draft.answer_text,
    draft.analysis,
    draft.raw_text,
    getQuestionTypeLabel(draft.type),
    ...(draft.options ? Object.values(draft.options) : []),
  ]
    .join(" ")
    .toLowerCase();
}

function DraftStatusBadges({ draft }: { draft: QuestionImportDraft }) {
  const blockingIssues = getBlockingImportIssues(draft);
  const missingAnswer = hasMissingAnswer(draft);

  return (
    <>
      {blockingIssues.length > 0 ? (
        <Badge className="h-5 gap-1 rounded-full border-none bg-amber-100 px-2 text-[11px] font-bold text-amber-800">
          <AlertTriangle className="h-3 w-3" />
          解析异常
        </Badge>
      ) : null}
      {missingAnswer ? (
        <Badge className="h-5 gap-1 rounded-full border-none bg-violet-100 px-2 text-[11px] font-bold text-violet-700">
          <FileWarning className="h-3 w-3" />
          无答案
        </Badge>
      ) : null}
      {draft.doubt ? (
        <Badge className="h-5 gap-1 rounded-full border-none bg-orange-100 px-2 text-[11px] font-bold text-orange-700">
          <HelpCircle className="h-3 w-3" />
          存疑
        </Badge>
      ) : null}
    </>
  );
}

function draftToPreviewQuestion(draft: QuestionImportDraft): IQuestion {
  const now = new Date().toISOString();
  const title = draft.title || generateImportQuestionTitle(draft.content_text);

  return {
    id: draft.draft_id,
    type: draft.type,
    title,
    content: {
      text: draft.content_text,
      html: importTextToHtml(draft.content_text),
    },
    options: draft.type === "choice" ? draft.options : null,
    answer: buildAnswerPayload(draft.type, draft.answer_text),
    analysis: draft.analysis,
    difficulty: Math.min(5, Math.max(1, Math.round(draft.difficulty || 3))),
    score: 10,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "",
    created_by_name: "",
    created_at: now,
    updated_at: now,
  };
}

function QuestionCard({
  draft,
  index,
  onEdit,
  onDelete,
}: {
  draft: QuestionImportDraft;
  index: number;
  onEdit: (draft: QuestionImportDraft) => void;
  onDelete: (draft: QuestionImportDraft) => void;
}) {
  const blockingIssues = getBlockingImportIssues(draft);
  const missingAnswer = hasMissingAnswer(draft);
  const previewQuestion = useMemo(() => draftToPreviewQuestion(draft), [draft]);

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        blockingIssues.length > 0
          ? "border-amber-200"
          : missingAnswer
            ? "border-violet-200"
            : draft.doubt
              ? "border-orange-200"
              : "border-slate-100",
      )}
    >
      <QuestionPreviewCard
        question={previewQuestion}
        index={index}
        mode="detailed"
        hideAnswer={missingAnswer}
        className="border-0 bg-transparent p-0 shadow-none"
        trailing={
          <div className="flex flex-wrap items-center justify-end gap-1">
            <DraftStatusBadges draft={draft} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs font-bold text-slate-500 hover:text-slate-900"
              onClick={() => onEdit(draft)}
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs font-bold text-red-500 hover:bg-red-50 hover:text-red-600"
              onClick={() => onDelete(draft)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        }
      />

      {blockingIssues.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-800">
          {blockingIssues.join("；")}
        </div>
      ) : null}

      {draft.doubt && draft.doubt_reason ? (
        <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs font-medium leading-5 text-orange-800">
          <span className="font-bold">存疑：</span>
          {draft.doubt_reason}
        </div>
      ) : null}

      {draft.suggested_knowledge_points &&
      draft.suggested_knowledge_points.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-slate-400">关联知识点：</span>
          {draft.suggested_knowledge_points.map((kp) => (
            <Badge
              key={kp.id}
              variant="secondary"
              className="h-5 text-[11px]"
            >
              {kp.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ImportEditDialog({
  draft,
  onOpenChange,
  onSave,
}: {
  draft: QuestionImportDraft | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draftId: string, patch: Partial<QuestionImportDraft>) => void;
}) {
  const [editingDraft, setEditingDraft] = useState<QuestionImportDraft | null>(draft);

  useEffect(() => {
    setEditingDraft(draft);
  }, [draft]);

  const updateOption = (key: string, value: string) => {
    setEditingDraft((current) =>
      current
        ? {
            ...current,
            options: {
              ...(current.options ?? {}),
              [key]: value,
            },
          }
        : current,
    );
  };

  const addOption = () => {
    setEditingDraft((current) => {
      if (!current) return current;
      const keys = Object.keys(current.options ?? {});
      const nextKey = String.fromCharCode(65 + keys.length);
      return {
        ...current,
        options: {
          ...(current.options ?? {}),
          [nextKey]: "",
        },
      };
    });
  };

  const removeOption = (key: string) => {
    setEditingDraft((current) => {
      if (!current?.options) return current;
      const nextOptions = { ...current.options };
      delete nextOptions[key];
      return { ...current, options: nextOptions };
    });
  };

  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑题目</DialogTitle>
          <DialogDescription>修改后可切换到预览，确认展示效果再保存。</DialogDescription>
        </DialogHeader>

        {editingDraft ? (
          <Tabs defaultValue="edit" className="min-w-0">
            <TabsList>
              <TabsTrigger value="edit">编辑</TabsTrigger>
              <TabsTrigger value="preview">预览</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="mt-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>题型</Label>
                  <Select
                    value={editingDraft.type}
                    onValueChange={(value) =>
                      setEditingDraft((current) =>
                        current ? { ...current, type: value as QuestionType } : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择题型" />
                    </SelectTrigger>
                    <SelectContent>
                      {editableTypeOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>题目内容</Label>
                  <Textarea
                    value={editingDraft.content_text}
                    onChange={(event) =>
                      setEditingDraft((current) =>
                        current ? { ...current, content_text: event.target.value } : current,
                      )
                    }
                    className="min-h-36 leading-7"
                    placeholder="请输入题目内容，支持 $LaTeX$ 公式"
                  />
                </div>

                {editingDraft.type === "choice" ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>选项</Label>
                      <Button type="button" variant="outline" size="sm" onClick={addOption}>
                        添加选项
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      {Object.entries(editingDraft.options ?? { A: "", B: "", C: "", D: "" }).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <button
                            type="button"
                            className={cn(
                              "flex h-7 min-w-7 items-center justify-center rounded-full text-xs font-black transition-colors",
                              editingDraft.answer_text?.trim() === key
                                ? "bg-primary text-white"
                                : "bg-slate-100 text-slate-400 hover:bg-primary/10 hover:text-primary",
                            )}
                            onClick={() =>
                              setEditingDraft((current) =>
                                current ? { ...current, answer_text: key } : current,
                              )
                            }
                          >
                            {key}
                          </button>
                          <Input
                            value={value}
                            onChange={(event) => updateOption(key, event.target.value)}
                            placeholder={`选项 ${key}`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-500"
                            onClick={() => removeOption(key)}
                          >
                            删除
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>答案</Label>
                    <Textarea
                      value={editingDraft.answer_text ?? ""}
                      onChange={(event) =>
                        setEditingDraft((current) =>
                          current ? { ...current, answer_text: event.target.value } : current,
                        )
                      }
                      className="min-h-24 leading-7"
                      placeholder="请输入答案"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>解析</Label>
                    <Textarea
                      value={editingDraft.analysis ?? ""}
                      onChange={(event) =>
                        setEditingDraft((current) =>
                          current ? { ...current, analysis: event.target.value } : current,
                        )
                      }
                      className="min-h-24 leading-7"
                      placeholder="请输入解析"
                    />
                  </div>
                </div>

                {editingDraft.doubt || editingDraft.doubt_reason ? (
                  <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs font-medium leading-5 text-orange-800">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!editingDraft.doubt}
                          onChange={(e) =>
                            setEditingDraft((current) =>
                              current
                                ? { ...current, doubt: !e.target.checked, doubt_reason: e.target.checked ? null : current.doubt_reason }
                                : current,
                            )
                          }
                          className="size-3.5 rounded border-orange-300 text-primary accent-primary"
                        />
                        <span className="font-bold">存疑</span>
                      </label>
                    </div>
                    {editingDraft.doubt_reason ? (
                      <p className="mt-1">{editingDraft.doubt_reason}</p>
                    ) : null}
                  </div>
                ) : null}

                {editingDraft.suggested_knowledge_points &&
                editingDraft.suggested_knowledge_points.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-slate-400">
                      关联知识点：
                    </span>
                    {editingDraft.suggested_knowledge_points.map((kp) => (
                      <Badge
                        key={kp.id}
                        variant="secondary"
                        className="h-5 text-[11px]"
                      >
                        {kp.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <QuestionPreviewCard
                question={draftToPreviewQuestion(editingDraft)}
                mode="detailed"
                defaultExpanded
                hideAnswer={hasMissingAnswer(editingDraft)}
                className="border-slate-100 bg-white shadow-none"
                trailing={<DraftStatusBadges draft={editingDraft} />}
              />
            </TabsContent>
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!editingDraft}
            onClick={() => {
              if (!editingDraft) return;
              onSave(editingDraft.draft_id, {
                title: generateImportQuestionTitle(editingDraft.content_text),
                type: editingDraft.type,
                content_text: editingDraft.content_text,
                options: editingDraft.type === "choice" ? editingDraft.options : null,
                answer_text: editingDraft.answer_text,
                analysis: editingDraft.analysis,
                doubt: editingDraft.doubt,
                doubt_reason: editingDraft.doubt_reason,
                review_status: "pending",
                review_required: true,
              });
              onOpenChange(false);
            }}
          >
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportReviewWorkspace({
  drafts,
  onChangeDraft,
  onDeleteDraft,
}: {
  drafts: QuestionImportDraft[];
  onChangeDraft: (draftId: string, patch: Partial<QuestionImportDraft>) => void;
  onDeleteDraft: (draftId: string) => void;
}) {
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [query, setQuery] = useState("");
  const [editingDraft, setEditingDraft] = useState<QuestionImportDraft | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<QuestionImportDraft | null>(null);

  const blockingIssueCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length > 0).length,
    [drafts],
  );
  const missingAnswerCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length === 0 && hasMissingAnswer(draft)).length,
    [drafts],
  );
  const doubtCount = useMemo(
    () => drafts.filter((draft) => Boolean(draft.doubt)).length,
    [drafts],
  );

  const visibleDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return drafts.filter((draft) => {
      if (filter === "issues" && getBlockingImportIssues(draft).length === 0) return false;
      if (filter === "missing_answer" && (getBlockingImportIssues(draft).length > 0 || !hasMissingAnswer(draft))) return false;
      if (filter === "doubt" && !draft.doubt) return false;
      if (!["all", "issues", "missing_answer", "doubt"].includes(filter) && draft.type !== filter) return false;
      if (!normalizedQuery) return true;
      return searchableText(draft).includes(normalizedQuery);
    });
  }, [drafts, filter, query]);

  const countByType = (type: QuestionType) => drafts.filter((draft) => draft.type === type).length;

  return (
    <div className="flex h-full min-h-0 bg-slate-50">
      <aside className="flex w-[240px] shrink-0 flex-col gap-5 border-r border-slate-100 bg-white p-4">
        {(blockingIssueCount > 0 || missingAnswerCount > 0 || doubtCount > 0) ? (
          <div className="flex flex-col gap-2">
            {blockingIssueCount > 0 ? (
              <button
                type="button"
                onClick={() => setFilter(filter === "issues" ? "all" : "issues")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                  filter === "issues"
                    ? "border-amber-400 bg-amber-50 shadow-sm"
                    : "border-amber-100 bg-amber-50/50 hover:border-amber-300",
                )}
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-amber-900">解析异常</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-amber-700">会被跳过</span>
                </span>
                <Badge className="border-none bg-amber-200 text-amber-900">{blockingIssueCount}</Badge>
              </button>
            ) : null}
            {missingAnswerCount > 0 ? (
              <button
                type="button"
                onClick={() => setFilter(filter === "missing_answer" ? "all" : "missing_answer")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                  filter === "missing_answer"
                    ? "border-violet-400 bg-violet-50 shadow-sm"
                    : "border-violet-100 bg-violet-50/50 hover:border-violet-300",
                )}
              >
                <FileWarning className="h-4 w-4 shrink-0 text-violet-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-violet-900">无答案</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-violet-700">可继续导入</span>
                </span>
                <Badge className="border-none bg-violet-200 text-violet-900">{missingAnswerCount}</Badge>
              </button>
            ) : null}
            {doubtCount > 0 ? (
              <button
                type="button"
                onClick={() => setFilter(filter === "doubt" ? "all" : "doubt")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                  filter === "doubt"
                    ? "border-orange-400 bg-orange-50 shadow-sm"
                    : "border-orange-100 bg-orange-50/50 hover:border-orange-300",
                )}
              >
                <HelpCircle className="h-4 w-4 shrink-0 text-orange-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-orange-900">存疑项</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-orange-700">建议人工核对</span>
                </span>
                <Badge className="border-none bg-orange-200 text-orange-900">{doubtCount}</Badge>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">题型筛选</p>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "flex h-9 items-center justify-between rounded-lg px-3 text-sm font-bold transition-colors",
              filter === "all" ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            全部题目
            <span className={cn("rounded-full px-2 py-0.5 text-xs", filter === "all" ? "bg-primary text-white" : "bg-slate-100 text-slate-500")}>
              {drafts.length}
            </span>
          </button>
          {typeFilterOptions.map((item) => {
            const count = countByType(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={cn(
                  "flex h-9 items-center justify-between rounded-lg px-3 text-sm font-bold transition-colors",
                  filter === item.value ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-50",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", item.dotClass)} />
                  {item.label}
                </span>
                {count > 0 ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", filter === item.value ? "bg-primary text-white" : "bg-slate-100 text-slate-500")}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-slate-100 bg-white px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索题目内容、答案、解析或选项..."
              className="h-10 rounded-xl border-slate-100 bg-slate-50 pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {visibleDrafts.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center text-slate-400">
              <Search className="h-9 w-9" />
              <p className="text-sm font-bold">没有匹配的题目</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[1040px] flex-col gap-3">
              {visibleDrafts.map((draft) => (
                <QuestionCard
                  key={draft.draft_id}
                  draft={draft}
                  index={drafts.findIndex((item) => item.draft_id === draft.draft_id) + 1}
                  onEdit={setEditingDraft}
                  onDelete={setDeletingDraft}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <ImportEditDialog
        draft={editingDraft}
        onOpenChange={(open) => {
          if (!open) setEditingDraft(null);
        }}
        onSave={onChangeDraft}
      />

      <AlertDialog open={Boolean(deletingDraft)} onOpenChange={(open) => !open && setDeletingDraft(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题目</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除这道题目吗？删除后不会导入到题库。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deletingDraft) return;
                onDeleteDraft(deletingDraft.draft_id);
                setDeletingDraft(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
