import { useMemo, useState } from "react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { htmlToPlainText } from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/utils";
import type { IQuestion, QuestionType } from "@/types";
import { QuestionEditFormContent, type QuestionEditSubmitValues } from "../edit";
import type { QuestionImportDraft } from "../import-types";
import {
  buildAnswerPayload,
  buildImportContentHtml,
  getBlockingImportIssues,
  getQuestionTypeLabel,
  generateImportQuestionTitle,
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

const typeOrder = new Map<QuestionType, number>(
  typeFilterOptions.map((item, index) => [item.value, index]),
);

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
      html: draft.content_html ?? buildImportContentHtml(draft.content_text, draft.images ?? []),
    },
    options: draft.type === "choice" ? draft.options : null,
    answer: draft.answer_html
      ? { ...buildAnswerPayload(draft.type, draft.answer_text), html: draft.answer_html }
      : buildAnswerPayload(draft.type, draft.answer_text),
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

// 答案值（来自题库编辑表单）还原成草稿的纯文本答案，供生成最终题目与兜底展示。
function answerTextFromEditValues(values: QuestionEditSubmitValues): string | null {
  const answer = values.answer ?? {};
  switch (values.type) {
    case "choice":
      return Array.isArray(answer.correct)
        ? (answer.correct as string[]).join("")
        : String(answer.correct ?? "");
    case "true_false":
      return answer.correct === true ? "正确" : "错误";
    case "fill_in":
      return Array.isArray(answer.correct)
        ? (answer.correct as string[]).join("\n")
        : String(answer.correct ?? "");
    case "code":
      return String(answer.code ?? "");
    default:
      return Array.isArray(answer.points)
        ? (answer.points as string[]).join("\n")
        : typeof answer.text === "string"
          ? answer.text
          : null;
  }
}

// 把题库编辑表单的提交值转换成草稿补丁；编辑后草稿需重新进入待核对状态。
function editValuesToDraftPatch(values: QuestionEditSubmitValues): Partial<QuestionImportDraft> {
  const isSubjective = values.type === "short_answer" || values.type === "essay";
  const contentHtml = typeof values.content.html === "string" ? values.content.html : "";
  const contentText =
    typeof values.content.text === "string" && values.content.text
      ? values.content.text
      : htmlToPlainText(contentHtml);
  const answerHtml = typeof values.answer.html === "string" ? values.answer.html : undefined;
  return {
    type: values.type,
    title: generateImportQuestionTitle(contentText),
    content_text: contentText,
    content_html: contentHtml || undefined,
    options: values.type === "choice" ? values.options : null,
    answer_text: answerTextFromEditValues(values),
    answer_html: isSubjective ? answerHtml : undefined,
    analysis: values.analysis ?? null,
    difficulty: Math.min(5, Math.max(1, Math.round(values.difficulty || 3))),
    review_status: "pending",
    review_required: true,
  };
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
  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑题目</DialogTitle>
          <DialogDescription>与题库的「修改题目」一致，保存后将重新进入待核对状态。</DialogDescription>
        </DialogHeader>

        {draft ? (
          <QuestionEditFormContent
            question={draftToPreviewQuestion(draft)}
            banks={[]}
            allTags={[]}
            knowledgePoints={[]}
            showHeader={false}
            showQuestionBankAndTags={false}
            allowTypeChange
            variant="dialog"
            submitLabel="保存修改"
            onCancel={() => onOpenChange(false)}
            onSubmit={(values) => {
              onSave(draft.draft_id, editValuesToDraftPatch(values));
              onOpenChange(false);
            }}
          />
        ) : null}
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

  const orderedDrafts = useMemo(() => {
    return drafts
      .map((draft, originalIndex) => ({ draft, originalIndex }))
      .sort((a, b) => {
        const typeDiff =
          (typeOrder.get(a.draft.type) ?? Number.MAX_SAFE_INTEGER) -
          (typeOrder.get(b.draft.type) ?? Number.MAX_SAFE_INTEGER);
        return typeDiff || a.originalIndex - b.originalIndex;
      })
      .map(({ draft }) => draft);
  }, [drafts]);

  const displayIndexByDraftId = useMemo(() => {
    return new Map(orderedDrafts.map((draft, index) => [draft.draft_id, index + 1]));
  }, [orderedDrafts]);

  const visibleDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orderedDrafts.filter((draft) => {
      if (filter === "issues" && getBlockingImportIssues(draft).length === 0) return false;
      if (filter === "missing_answer" && (getBlockingImportIssues(draft).length > 0 || !hasMissingAnswer(draft))) return false;
      if (filter === "doubt" && !draft.doubt) return false;
      if (!["all", "issues", "missing_answer", "doubt"].includes(filter) && draft.type !== filter) return false;
      if (!normalizedQuery) return true;
      return searchableText(draft).includes(normalizedQuery);
    });
  }, [filter, orderedDrafts, query]);

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
              {visibleDrafts.map((draft, visibleIndex) => (
                <QuestionCard
                  key={draft.draft_id}
                  draft={draft}
                  index={displayIndexByDraftId.get(draft.draft_id) ?? visibleIndex + 1}
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
