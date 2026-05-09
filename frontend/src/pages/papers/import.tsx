import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { ImportReviewWorkspace } from "@/pages/questions/components/import-review-workspace";
import type { QuestionImportDraft, QuestionImportImageInput } from "@/pages/questions/import-types";
import {
  buildImportSummary,
  emptyImportSummary,
  extractQuestionImportPayload,
  generateImportQuestionTitle,
  getBlockingImportIssues,
} from "@/pages/questions/import-utils";
import type { IPaperDetail, IPaperImportRecognizeResponse } from "@/types";

import { paperApiRequest } from "./api";

type ImportDocumentPayload = {
  fileName: string;
  rawText: string;
  sourceFormat: "pdf" | "docx" | "md";
  images: QuestionImportImageInput[];
};

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function PaperImportPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourcePayload, setSourcePayload] = useState<ImportDocumentPayload | null>(null);
  const [paperTitle, setPaperTitle] = useState("");
  const [paperDescription, setPaperDescription] = useState("");
  const [selectedRootKnowledgePoints, setSelectedRootKnowledgePoints] = useState<SelectedKnowledgePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const summary = drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const importableCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length === 0).length,
    [drafts],
  );
  const rootKnowledgePointId = selectedRootKnowledgePoints[0]?.id ?? null;

  const updateDraft = (draftId: string, patch: Partial<QuestionImportDraft>) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.draft_id === draftId
          ? {
              ...draft,
              ...patch,
              review_status: patch.review_status ?? draft.review_status,
              review_required: patch.review_required ?? draft.review_required,
            }
          : draft,
      ),
    );
  };

  const removeDraft = (draftId: string) => {
    setDrafts((current) => current.filter((draft) => draft.draft_id !== draftId));
  };

  const recognizePayload = async (payload: ImportDocumentPayload) => {
    const recognized = await paperApiRequest<IPaperImportRecognizeResponse>("/papers/import/recognize", {
      method: "POST",
      body: JSON.stringify({
        file_name: payload.fileName,
        raw_text: payload.rawText,
        source_format: payload.sourceFormat,
        root_knowledge_point_id: rootKnowledgePointId,
        images: payload.images ?? [],
      }),
    });
    const nextDrafts = recognized.drafts as unknown as QuestionImportDraft[];
    setSessionId(recognized.session_id);
    setDrafts(nextDrafts);
    setSourcePayload(payload);
    setParseError(null);
    if (!paperTitle.trim()) {
      const titleFromFile = payload.fileName.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
    }
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
      const payload = await extractQuestionImportPayload(file);
      await recognizePayload({
        fileName: file.name,
        rawText: payload.rawText,
        sourceFormat: payload.sourceFormat,
        images: payload.images,
      });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入识别失败");
      setDrafts([]);
      setSessionId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await processImportFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleReRecognize = async () => {
    if (!sourcePayload) return;
    setLoading(true);
    try {
      await recognizePayload(sourcePayload);
      toast({ title: "识别完成", description: `已重新识别 ${summary.total} 道题目` });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "重新识别失败");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!sessionId) return;
    if (!paperTitle.trim()) {
      setParseError("请填写试卷名称");
      return;
    }

    const reviewedDrafts = drafts.map((draft) => {
      const hasBlocking = getBlockingImportIssues(draft).length > 0;
      if (hasBlocking) {
        return { ...draft, review_status: "pending", review_required: true };
      }
      return {
        ...draft,
        title: draft.title || generateImportQuestionTitle(draft.content_text),
        review_status: "approved",
        review_required: false,
      };
    });

    const approvedCount = reviewedDrafts.filter((draft) => draft.review_status === "approved").length;
    if (approvedCount === 0) {
      setParseError("没有可入库的题目，请先处理解析异常题目。");
      return;
    }

    setImporting(true);
    setParseError(null);
    try {
      const paper = await paperApiRequest<IPaperDetail>(`/papers/import/sessions/${sessionId}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          title: paperTitle.trim(),
          description: paperDescription.trim() || null,
          root_knowledge_point_id: rootKnowledgePointId,
          drafts: reviewedDrafts,
        }),
      });
      toast({ title: "导入成功", description: `已创建试卷：${paper.title}` });
      navigate(`/papers/${paper.id}`);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/papers")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回试卷列表
          </Button>
          <h1 className="text-xl font-semibold text-foreground">导入试卷</h1>
        </div>
        {drafts.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">已识别 {summary.total} 题</Badge>
            <Badge variant={importableCount > 0 ? "default" : "secondary"}>可入库 {importableCount} 题</Badge>
          </div>
        )}
      </div>

      {parseError && (
        <Alert variant="destructive" className="flex items-start gap-2 [&>svg]:static [&>svg]:translate-y-0">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-8 py-12 text-center">
          <input
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.docx,.md,.markdown"
            onChange={(event) => void handleFileChange(event)}
            type="file"
          />
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Upload className="h-7 w-7" />
          </div>
          <p className="mb-2 text-base font-semibold text-foreground">上传历史试卷文件</p>
          <p className="mb-5 text-sm text-muted-foreground">支持 PDF、Word、Markdown，单文件不超过 20MB</p>
          <Button onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            选择文件并识别
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>试卷名称</Label>
              <Input value={paperTitle} onChange={(event) => setPaperTitle(event.target.value)} placeholder="请输入试卷名称" />
            </div>
            <div className="space-y-2">
              <Label>主知识点（可选）</Label>
              <KnowledgePointSelector
                fetcher={(path, options) => paperApiRequest(path, options)}
                selectedKnowledgePoints={selectedRootKnowledgePoints}
                onSelectedKnowledgePointsChange={setSelectedRootKnowledgePoints}
                storageKey="paper-import-root-knowledge-recent-keywords"
                label="主知识点"
                triggerLabel="搜索或展开知识图谱选择主知识点"
                popoverSide="bottom"
                popoverContentStyle={{ maxHeight: "min(340px, calc(100dvh - 360px))" }}
                selectionTarget="root"
                selectionMode="single"
                showUsageShortcuts={false}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>试卷描述（可选）</Label>
              <Textarea
                value={paperDescription}
                onChange={(event) => setPaperDescription(event.target.value)}
                placeholder="可填写试卷来源、用途等说明"
              />
            </div>
            <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={handleReRecognize} disabled={loading || importing}>
                {loading ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                重新识别
              </Button>
              <Button onClick={handleConfirmImport} disabled={loading || importing}>
                {importing ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                确认入库
              </Button>
            </div>
          </div>

          <ImportReviewWorkspace drafts={drafts} onChangeDraft={updateDraft} onDeleteDraft={removeDraft} />
        </>
      )}
    </div>
  );
}
