import { useList } from "@refinedev/core";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, FileText, FileUp, LoaderCircle, Upload } from "lucide-react";

import type { IQuestionBank } from "@/types";
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
import { cn } from "@/lib/utils";
import { ImportReviewEditor } from "./components/import-review-editor";
import { ImportReviewSidebar } from "./components/import-review-sidebar";
import { ImportSummaryBar } from "./components/import-summary-bar";
import type {
  ImportFilter,
  ImportRecognitionMode,
  QuestionImportDocumentRecognizeResponse,
  QuestionImportDraft,
} from "./import-types";
import {
  buildImportableQuestions,
  buildImportSummary,
  detectQuestionImportFormat,
  emptyImportSummary,
  extractQuestionImportText,
  generateImportQuestionTitle,
} from "./import-utils";

async function questionApiFetch<T>(url: string, options?: RequestInit): Promise<T> {
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

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function QuestionImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [mode, setMode] = useState<ImportRecognitionMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [recognizingDraftId, setRecognizingDraftId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [questionBankId, setQuestionBankId] = useState<string>("__none__");
  const [isDragActive, setIsDragActive] = useState(false);
  const [filter, setFilter] = useState<ImportFilter>("pending");

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.draft_id === selectedDraftId) ?? null,
    [drafts, selectedDraftId],
  );
  const summary = drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const approvedCount = summary.approved;
  const completionPercent = summary.total > 0 ? Math.round((summary.approved / summary.total) * 100) : 0;

  const selectNextReviewTarget = (currentDraftId: string) => {
    const nextPending = drafts.find(
      (draft) => draft.draft_id !== currentDraftId && draft.review_status === "pending",
    );
    const nextAny = drafts.find((draft) => draft.draft_id !== currentDraftId);
    setSelectedDraftId(nextPending?.draft_id ?? nextAny?.draft_id ?? currentDraftId);
  };

  const processImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请上传 20 MB 以内的文件。`);
      return;
    }

    setLoading(true);
    setParseError(null);
    try {
      const sourceFormat = detectQuestionImportFormat(file.name);
      const rawText = await extractQuestionImportText(file);
      const response = await questionApiFetch<QuestionImportDocumentRecognizeResponse>(
        "/api/questions/import/document-recognize",
        {
          method: "POST",
          body: JSON.stringify({
            file_name: file.name,
            raw_text: rawText,
            source_format: sourceFormat,
          }),
        },
      );
      setDrafts(response.drafts);
      setSelectedDraftId(response.drafts[0]?.draft_id ?? null);
      setSourceFileName(file.name);
      setMode(response.mode);
      setFilter("pending");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "文件解析失败");
      setDrafts([]);
      setSelectedDraftId(null);
      setMode(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await processImportFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const updateDraft = (draftId: string, patch: Partial<QuestionImportDraft>) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.draft_id === draftId
          ? {
              ...draft,
              ...patch,
              review_status: patch.review_status ?? "pending",
              review_required: patch.review_required ?? true,
            }
          : draft,
      ),
    );
  };

  const reRecognizeSelectedDraft = async () => {
    if (!selectedDraft) return;
    setRecognizingDraftId(selectedDraft.draft_id);
    setParseError(null);
    try {
      const response = await questionApiFetch<QuestionImportDraft>("/api/questions/import/re-recognize", {
        method: "POST",
        body: JSON.stringify({ raw_text: selectedDraft.raw_text }),
      });
      setDrafts((current) =>
        current.map((draft) =>
          draft.draft_id === selectedDraft.draft_id
            ? { ...response, draft_id: selectedDraft.draft_id, review_status: "pending", review_required: true }
            : draft,
        ),
      );
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "AI 补全失败");
    } finally {
      setRecognizingDraftId(null);
    }
  };

  const importApprovedDrafts = async () => {
    const bankId = questionBankId === "__none__" ? null : questionBankId;
    const questions = buildImportableQuestions(drafts, bankId);
    if (questions.length === 0) {
      setParseError("请先人工确认至少一道题目后再导入。");
      return;
    }

    setImporting(true);
    setParseError(null);
    try {
      await questionApiFetch<{ created: number }>("/api/questions/bulk", {
        method: "POST",
        body: JSON.stringify({ questions }),
      });
      navigate("/questions");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/questions")} type="button">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-foreground">导入题目</h1>
              <p className="text-sm text-muted-foreground">
                上传文件后逐题审核，确认一题才导入一题。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              ref={fileInputRef}
              className="hidden"
              id="question-import-file"
              accept=".pdf,.docx,.md,.markdown"
              onChange={(event) => void handleFileChange(event)}
              type="file"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setIsDragActive(false);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);
                void processImportFile(event.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                isDragActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:border-primary/50 hover:bg-muted",
              )}
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {sourceFileName ? "重新上传" : "上传文件"}
            </button>

            <div className="flex items-center gap-2">
              <Label className="sr-only">导入到题库</Label>
              <Select value={questionBankId} onValueChange={setQuestionBankId}>
                <SelectTrigger className="h-10 w-[200px] bg-background">
                  <SelectValue placeholder="不指定题库" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不指定题库</SelectItem>
                  {banks.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                disabled={drafts.length === 0 || approvedCount === 0 || importing}
                onClick={() => void importApprovedDrafts()}
                type="button"
                className="h-10"
              >
                {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                导入 {approvedCount} 题
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
            <ImportSummaryBar summary={summary} fileName={sourceFileName} mode={mode} />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">审核进度</span>
                <span className="font-medium text-foreground">{completionPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {parseError && (
          <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} />
              {parseError}
            </div>
          </div>
        )}
      </header>

      <main className="grid min-h-0 flex-1 bg-muted/20 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-h-0 border-r border-border bg-background">
          <ImportReviewSidebar
            drafts={drafts}
            selectedDraftId={selectedDraftId}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={setSelectedDraftId}
          />
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          {drafts.length === 0 && !loading ? (
            <section className="flex h-full min-h-[520px] items-center justify-center">
              <div className="max-w-xl rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileText size={24} />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-foreground">上传文件后，系统会自动拆题并生成审核清单</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  支持 PDF、Word(docx)、Markdown。识别完成后，你只需要从左侧逐题确认，必要时在右侧直接修改内容、答案、解析和难度。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-3 py-1">1. 上传文件</span>
                  <span className="rounded-full bg-muted px-3 py-1">2. 检查识别结果</span>
                  <span className="rounded-full bg-muted px-3 py-1">3. 确认后导入</span>
                </div>
                <Button className="mt-6" onClick={() => fileInputRef.current?.click()} type="button">
                  <Upload size={16} />
                  选择题目文件
                </Button>
              </div>
            </section>
          ) : loading ? (
            <section className="flex h-full min-h-[520px] items-center justify-center">
              <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                正在识别题目，稍等一下...
              </div>
            </section>
          ) : (
          <ImportReviewEditor
            draft={selectedDraft}
            isRecognizing={recognizingDraftId === selectedDraft?.draft_id}
            onChange={(patch) => {
              if (selectedDraft) updateDraft(selectedDraft.draft_id, patch);
            }}
            onApprove={() => {
              if (selectedDraft) {
                updateDraft(selectedDraft.draft_id, {
                  title: generateImportQuestionTitle(selectedDraft.content_text),
                  review_status: "approved",
                  review_required: false,
                });
                selectNextReviewTarget(selectedDraft.draft_id);
              }
            }}
            onSkip={() => {
              if (selectedDraft) {
                updateDraft(selectedDraft.draft_id, { review_status: "skipped", review_required: false });
                selectNextReviewTarget(selectedDraft.draft_id);
              }
            }}
            onReRecognize={() => void reRecognizeSelectedDraft()}
          />
          )}
        </div>
      </main>
    </div>
  );
}
