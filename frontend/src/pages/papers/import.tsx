import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Eye, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { ImportReviewWorkspace } from "@/pages/questions/components/import-review-workspace";
import type { QuestionImportDraft, QuestionImportImageInput, QuestionImportTableInput } from "@/pages/questions/import-types";
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
  tables?: QuestionImportTableInput[];
  originalFile?: File;
};

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PAPER_PDF_PAGE_IMAGE_QUALITY = 0.92;
const PAPER_PDF_PAGE_IMAGE_MAX_EDGE = 2048;

async function extractPaperImportPayload(file: File): Promise<ImportDocumentPayload> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf") {
    const payload = await extractQuestionImportPayload(file);
    return {
      fileName: file.name,
      rawText: payload.rawText,
      sourceFormat: payload.sourceFormat,
      images: payload.images,
      tables: payload.tables,
      originalFile: file,
    };
  }

  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const images: QuestionImportImageInput[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(1.5, PAPER_PDF_PAGE_IMAGE_MAX_EDGE / Math.max(baseViewport.width, baseViewport.height)),
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("PDF 渲染失败");
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const imageId = `page-${pageNumber}`;
    images.push({
      image_id: imageId,
      url: canvas.toDataURL("image/jpeg", PAPER_PDF_PAGE_IMAGE_QUALITY),
      order: pageNumber,
      page: pageNumber,
      alt: `第 ${pageNumber} 页`,
    });
  }

  return {
    fileName: file.name,
    rawText: images.map((image) => `[IMAGE:${image.image_id}]`).join("\n"),
    sourceFormat: "pdf",
    images,
    tables: [],
    originalFile: file,
  };
}

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
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const showReviewer = drafts.length > 0;
  const sourceFileName = sourcePayload?.fileName ?? "";
  const summary = drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const importableCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length === 0).length,
    [drafts],
  );
  const blockingIssueCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length > 0).length,
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
    let recognized: IPaperImportRecognizeResponse;
    if (payload.sourceFormat === "docx" && payload.originalFile) {
      const formData = new FormData();
      formData.append("file", payload.originalFile);
      formData.append(
        "prompt",
        "请直接识别 Word 试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。",
      );
      recognized = await paperApiRequest<IPaperImportRecognizeResponse>("/papers/import/recognize-file", {
        method: "POST",
        body: formData,
      });
    } else {
      recognized = await paperApiRequest<IPaperImportRecognizeResponse>("/papers/import/recognize", {
        method: "POST",
        body: JSON.stringify({
          file_name: payload.fileName,
          raw_text: payload.rawText,
          source_format: payload.sourceFormat,
          root_knowledge_point_id: null,
          images: payload.images ?? [],
          tables: payload.tables ?? [],
          recognition_prompt:
            "请直接识别试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。",
        }),
      });
    }
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
      const payload = await extractPaperImportPayload(file);
      const titleFromFile = file.name.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
      setPaperDescription("");
      setSelectedRootKnowledgePoints([]);
      await recognizePayload(payload);
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

  const handleVisualRecognize = async () => {
    if (!sourcePayload?.originalFile) {
      setParseError("未找到原始文件，请重新上传后再试。");
      return;
    }
    setLoading(true);
    setParseError(null);
    try {
      const formData = new FormData();
      formData.append("file", sourcePayload.originalFile);
      const recognized = await paperApiRequest<IPaperImportRecognizeResponse>(
        "/papers/import/recognize-visual",
        { method: "POST", body: formData },
      );
      const nextDrafts = recognized.drafts as unknown as QuestionImportDraft[];
      setSessionId(recognized.session_id);
      setDrafts(nextDrafts);
      toast({ title: "视觉识别完成", description: `已识别 ${nextDrafts.length} 道题目` });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "视觉识别失败");
    } finally {
      setLoading(false);
    }
  };

  const openConfirmDialog = () => {
    if (importableCount === 0) {
      setParseError("没有可入库的题目，请先处理解析异常题目。");
      return;
    }
    if (!paperTitle.trim() && sourcePayload?.fileName) {
      const titleFromFile = sourcePayload.fileName.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
    }
    setParseError(null);
    setConfirmDialogOpen(true);
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
      setConfirmDialogOpen(false);
      toast({ title: "导入成功", description: `已创建试卷：${paper.title}` });
      navigate(`/papers/${paper.id}`);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f8fafc]">
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-100 bg-white">
        <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2 lg:px-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (showReviewer) {
                  setDrafts([]);
                  setSessionId(null);
                  setParseError(null);
                  return;
                }
                navigate("/papers");
              }}
              className="size-8 rounded-lg border-slate-200 p-0 transition-all hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 lg:text-base">
                  {showReviewer ? "核对导入内容" : "导入试卷"}
                </h1>
                {showReviewer && (
                  <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[11px] font-bold text-primary">
                    审核模式
                  </Badge>
                )}
              </div>
              <p className="max-w-[360px] truncate text-xs leading-snug text-muted-foreground">
                {showReviewer ? `正在处理: ${sourceFileName}` : "上传历史试卷并校对后入库"}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {showReviewer && (
              <>
                <div className="hidden items-center gap-4 border-r border-slate-100 pr-4 lg:flex">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">总数</span>
                    <span className="text-base font-black leading-none text-slate-900">{summary.total}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">可入库</span>
                    <span className="text-base font-black leading-none text-primary">{importableCount}</span>
                  </div>
                </div>

                {blockingIssueCount > 0 && (
                  <Badge className="hidden h-7 border-none bg-amber-100 px-3 text-xs font-bold text-amber-800 md:inline-flex">
                    {blockingIssueCount} 道解析异常，将跳过入库
                  </Badge>
                )}

                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || importing || !sourcePayload}
                  onClick={handleReRecognize}
                  className="h-9 rounded-lg px-3 text-sm font-bold"
                >
                  {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  重新识别
                </Button>

                {sourcePayload?.sourceFormat === "docx" && sourcePayload?.originalFile ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading || importing}
                    onClick={handleVisualRecognize}
                    className="h-9 rounded-lg px-3 text-sm font-bold"
                  >
                    {loading ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    页面视觉识别
                  </Button>
                ) : null}
                </Button>

                <Button
                  type="button"
                  disabled={loading || importing || importableCount === 0}
                  onClick={openConfirmDialog}
                  className="h-9 rounded-lg px-4 text-sm font-bold shadow-sm shadow-primary/20"
                >
                  {importing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                  确认入库
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {parseError && (
        <div className="mx-8 mt-6">
          <Alert variant="destructive" className="flex items-start gap-3 rounded-[16px] border-none bg-red-50 p-4 text-red-600 shadow-sm [&>svg]:static [&>svg]:translate-y-0">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-sm font-medium leading-snug">{parseError}</AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!showReviewer ? (
          <div className="flex flex-1 items-center justify-center p-8 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
            <div className="w-full max-w-2xl rounded-[40px] border-2 border-dashed border-slate-100 bg-white px-8 py-14 text-center shadow-2xl shadow-slate-200/40">
              <input
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,.md,.markdown"
                onChange={(event) => void handleFileChange(event)}
                type="file"
              />
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-slate-50 text-slate-400">
                <Upload className="h-10 w-10" />
              </div>
              <p className="mb-2 text-base font-bold tracking-tight text-slate-900 uppercase">开始导入试卷</p>
              <p className="mb-6 text-sm leading-snug text-muted-foreground">支持 PDF、Word、Markdown，单文件不超过 20MB</p>
              <Button onClick={() => fileInputRef.current?.click()} disabled={loading} className="h-11 rounded-xl px-6 text-sm font-semibold shadow-sm shadow-primary/20">
                {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                选择文件并识别
              </Button>
            </div>
          </div>
        ) : (
          <ImportReviewWorkspace drafts={drafts} onChangeDraft={updateDraft} onDeleteDraft={removeDraft} />
        )}
      </main>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>确认入库试卷</DialogTitle>
            <DialogDescription>
              确认试卷信息并选择主知识点。主知识点可理解为课程名称，用于后续检索和 AI 生成。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="paper-import-title">试卷名称</Label>
              <Input
                id="paper-import-title"
                value={paperTitle}
                onChange={(event) => setPaperTitle(event.target.value)}
                placeholder="请输入试卷名称"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="paper-import-description">试卷描述（可选）</Label>
              <Textarea
                id="paper-import-description"
                value={paperDescription}
                onChange={(event) => setPaperDescription(event.target.value)}
                placeholder="可填写试卷来源、适用班级、用途等说明"
                className="min-h-24"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label>主知识点</Label>
                <span className="text-xs text-muted-foreground">课程名称</span>
              </div>
              <KnowledgePointSelector
                fetcher={(path, options) => paperApiRequest(path, options)}
                selectedKnowledgePoints={selectedRootKnowledgePoints}
                onSelectedKnowledgePointsChange={setSelectedRootKnowledgePoints}
                storageKey="paper-import-root-knowledge-recent-keywords"
                label="主知识点"
                triggerLabel="搜索或展开知识图谱选择课程名称"
                popoverSide="bottom"
                popoverContentStyle={{ maxHeight: "min(340px, calc(100dvh - 260px))" }}
                selectionTarget="root"
                selectionMode="single"
                showUsageShortcuts={false}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)} disabled={importing}>
              取消
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing || !paperTitle.trim()}>
              {importing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              确定入库
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
