import { useList } from "@refinedev/core";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileUp, LoaderCircle, Upload } from "lucide-react";

import type { IQuestionBank } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ImportTemplateHelp } from "./components/import-template-help";
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground">导入题目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            支持 PDF、Word(docx)、Markdown，识别后必须人工审核确认再导入。
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/questions")} type="button">
          <ArrowLeft className="h-4 w-4" />
          返回题目列表
        </Button>
      </div>

      <ImportSummaryBar summary={summary} fileName={sourceFileName} mode={mode} />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">导入设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="question-import-file">上传文件</Label>
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
                    "flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors",
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/35",
                  )}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                  </div>
                  <div className="mt-3 space-y-1">
                    <p className="text-sm font-medium text-foreground">拖拽文件到这里，或点击上传</p>
                    <p className="text-xs text-muted-foreground">支持 PDF、Word(docx)、Markdown</p>
                  </div>
                </button>
                <p className="text-xs text-muted-foreground">旧 Word `.doc` 请先另存为 `.docx`。</p>
              </div>

              <div className="space-y-2">
                <Label>导入到题库</Label>
                <Select value={questionBankId} onValueChange={setQuestionBankId}>
                  <SelectTrigger>
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
              </div>

              {parseError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {parseError}
                </div>
              )}

              <Button
                disabled={drafts.length === 0 || approvedCount === 0 || importing}
                onClick={() => void importApprovedDrafts()}
                type="button"
                className="w-full"
              >
                {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                导入已确认题目（{approvedCount}）
              </Button>
            </CardContent>
          </Card>

          <ImportTemplateHelp />
        </div>

        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <ImportReviewSidebar
            drafts={drafts}
            selectedDraftId={selectedDraftId}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={setSelectedDraftId}
          />
          <ImportReviewEditor
            draft={selectedDraft}
            isRecognizing={recognizingDraftId === selectedDraft?.draft_id}
            onChange={(patch) => {
              if (selectedDraft) updateDraft(selectedDraft.draft_id, patch);
            }}
            onApprove={() => {
              if (selectedDraft) {
                updateDraft(selectedDraft.draft_id, { review_status: "approved", review_required: false });
              }
            }}
            onSkip={() => {
              if (selectedDraft) {
                updateDraft(selectedDraft.draft_id, { review_status: "skipped", review_required: false });
              }
            }}
            onReRecognize={() => void reRecognizeSelectedDraft()}
          />
        </div>
      </div>
    </div>
  );
}
