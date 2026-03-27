import { useList } from "@refinedev/core";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Bot, FileUp, LoaderCircle, Sparkles, Trash2, Upload } from "lucide-react";

import type { IQuestionBank, QuestionType } from "@/types";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

GlobalWorkerOptions.workerSrc = pdfWorker;

type ImportedDraft = {
  id: string;
  title: string;
  type: QuestionType;
  contentText: string;
  options: Record<string, string>;
  answerText: string;
  analysis: string;
  difficulty: number;
  issues: string[];
  aiAnalysis?: string;
  aiDifficulty?: number;
  aiDifficultyReason?: string;
};

type ImportedQuestionRecognizeResponse = {
  type: QuestionType;
  content_text: string;
  options?: Record<string, string> | null;
  answer_text?: string | null;
};

const typeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: "choice", label: "选择题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

const difficultyOptions = [
  { value: 1, label: "容易" },
  { value: 2, label: "较易" },
  { value: 3, label: "一般" },
  { value: 4, label: "较难" },
  { value: 5, label: "很难" },
];

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function inferType(content: string, options: Record<string, string>, answer: string): QuestionType {
  const normalizedContent = content.replace(/\s+/g, " ").trim();
  const normalizedAnswer = answer.trim();

  if (Object.keys(options).length >= 3) {
    return "choice";
  }
  if (
    /(?:^|[\s:：])(正确|错误|对|错|true|false|t|f|√|×)(?:$|[\s,，。；;])/i.test(normalizedAnswer) ||
    /(?:\bT\/F\b|\bTrue\/False\b)/i.test(normalizedContent)
  ) {
    return "true_false";
  }
  if (/_{2,}|（\s*）|\(\s*\)|【\s*】|\[\s*\]|____/.test(normalizedContent)) {
    return "fill_in";
  }
  if (/```|代码|编程|程序|函数|class\s|def\s|public\s+class/i.test(content)) {
    return "code";
  }
  if (/论述|分析|阐述|作文|谈谈/i.test(content)) {
    return "essay";
  }
  return "short_answer";
}

function buildDraft(payload: Partial<ImportedDraft>): ImportedDraft {
  const title = (payload.title ?? "").trim();
  const contentText = (payload.contentText ?? title).trim();
  const derivedTitle = title || contentText.replace(/\s+/g, " ").slice(0, 120);
  const options = payload.options ?? {};
  const answerText = (payload.answerText ?? "").trim();
  const type = payload.type ?? inferType(contentText, options, answerText);
  const issues: string[] = [];

  if (!contentText) issues.push("题目内容为空");
  if (type === "choice" && Object.keys(options).length < 2) issues.push("选择题选项识别不完整");

  return {
    id: payload.id ?? crypto.randomUUID(),
    title: derivedTitle,
    type,
    contentText,
    options,
    answerText,
    analysis: payload.analysis ?? "",
    difficulty: payload.difficulty ?? 3,
    issues,
    aiAnalysis: payload.aiAnalysis,
    aiDifficulty: payload.aiDifficulty,
    aiDifficultyReason: payload.aiDifficultyReason,
  };
}

function shouldUseAiRecognition(draft: ImportedDraft): boolean {
  return !draft.contentText || (draft.type === "choice" && Object.keys(draft.options).length < 2);
}

function splitTextBlocks(rawText: string): string[][] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  const isStartLine = (line: string) => /^\s*(\d+[\.\)]|[一二三四五六七八九十]+[、.])\s*/.test(line);
  for (const line of lines) {
    if (isStartLine(line) && current.length > 0) {
      blocks.push(current);
      current = [line];
    } else if (line.trim() === "" && current.length > 0 && current[current.length - 1].trim() === "") {
      continue;
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function parseTextBlock(block: string[]): ImportedDraft {
  const cleaned = block.map((line) => line.trim()).filter(Boolean);
  const rawBlockText = cleaned.join("\n");
  const options: Record<string, string> = {};
  let answerText = "";
  let analysis = "";
  const contentLines: string[] = [];

  for (const line of cleaned.slice(1)) {
    const optionMatch = line.match(/^([A-H])[\.．、\)]\s*(.+)$/i);
    if (optionMatch) {
      options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
      continue;
    }
    const answerMatch = line.match(/^(?:答案|参考答案|answer)[:：]?\s*(.+)$/i);
    if (answerMatch) {
      answerText = answerMatch[1].trim();
      continue;
    }
    const analysisMatch = line.match(/^解析[:：]\s*(.+)$/);
    if (analysisMatch) {
      analysis = analysisMatch[1].trim();
      continue;
    }
    const trailingTrueFalseMatch = line.match(/(.+?)\s*[（(]?(?:√|×|T|F|True|False|正确|错误|对|错)[）)]?\s*$/i);
    if (trailingTrueFalseMatch && !answerText) {
      contentLines.push(trailingTrueFalseMatch[1].trim());
      answerText = line.slice(trailingTrueFalseMatch[1].length).replace(/[（）()\s]/g, "").trim();
      continue;
    }
    contentLines.push(line);
  }

  const inlineOptions = rawBlockText.match(/([A-H])[\.．、\)]\s*([^A-H]+?)(?=(?:\s+[A-H][\.．、\)])|$)/gi);
  if (Object.keys(options).length === 0 && inlineOptions) {
    for (const item of inlineOptions) {
      const match = item.match(/^([A-H])[\.．、\)]\s*(.+)$/i);
      if (match) {
        options[match[1].toUpperCase()] = match[2].trim();
      }
    }
  }

  if (!answerText) {
    const lastLine = cleaned.at(-1) ?? "";
    const choiceAnswerMatch = lastLine.match(/^(?:答案|参考答案)?[:：]?\s*([A-H](?:\s*[,，]\s*[A-H])*)$/i);
    if (choiceAnswerMatch) {
      answerText = choiceAnswerMatch[1].replace(/\s+/g, "");
    }
  }

  const contentText = contentLines.length > 0 ? contentLines.join("\n") : rawBlockText;
  return buildDraft({
    contentText,
    options,
    answerText,
    analysis,
  });
}

async function recognizeDraftWithAi(rawText: string): Promise<ImportedDraft> {
  const recognized = await questionApiFetch<ImportedQuestionRecognizeResponse>("/api/questions/import/recognize", {
    method: "POST",
    body: JSON.stringify({ raw_text: rawText }),
  });

  return buildDraft({
    type: recognized.type,
    contentText: recognized.content_text,
    options: recognized.options ?? {},
    answerText: recognized.answer_text ?? "",
  });
}

async function parseTextToDrafts(rawText: string): Promise<ImportedDraft[]> {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = splitTextBlocks(normalized);
  const drafts = await Promise.all(
    blocks.map(async (block) => {
      const parsed = parseTextBlock(block);
      if (!shouldUseAiRecognition(parsed)) {
        return parsed;
      }

      try {
        return await recognizeDraftWithAi(block.join("\n"));
      } catch {
        return parsed;
      }
    }),
  );

  return drafts.length > 0 ? drafts : [buildDraft({ contentText: normalized })];
}

function parseWorksheetRows(rows: unknown[][]): ImportedDraft[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const contentIndex = headers.findIndex((header) => ["题目", "标题", "title", "question", "content"].includes(header));
  const answerIndex = headers.findIndex((header) => ["答案", "answer"].includes(header));
  const analysisIndex = headers.findIndex((header) => ["解析", "analysis"].includes(header));
  const difficultyIndex = headers.findIndex((header) => ["难度", "difficulty"].includes(header));
  const optionIndexes = headers.reduce<Array<{ key: string; index: number }>>((acc, header, index) => {
    const match = header.match(/^(选项)?([a-h])$/i);
    if (match) acc.push({ key: match[2].toUpperCase(), index });
    return acc;
  }, []);

  if (contentIndex === -1) return [];

  return rows.slice(1).map((row) => {
    const options = optionIndexes.reduce<Record<string, string>>((acc, item) => {
      const value = String(row[item.index] ?? "").trim();
      if (value) acc[item.key] = value;
      return acc;
    }, {});

    return buildDraft({
      contentText: String(row[contentIndex] ?? "").trim(),
      options,
      answerText: answerIndex >= 0 ? String(row[answerIndex] ?? "").trim() : "",
      analysis: analysisIndex >= 0 ? String(row[analysisIndex] ?? "").trim() : "",
      difficulty: difficultyIndex >= 0 ? Number(row[difficultyIndex] ?? 3) || 3 : 3,
    });
  });
}

async function extractFileText(file: File): Promise<ImportedDraft[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "txt") {
    return parseTextToDrafts(await file.text());
  }

  if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return parseTextToDrafts(result.value);
  }

  if (extension === "pdf") {
    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      chunks.push(text.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return parseTextToDrafts(chunks.join("\n"));
  }

  if (extension === "xlsx" || extension === "xls") {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const allDraftGroups = await Promise.all(workbook.SheetNames.map(async (sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as unknown[][];
      const structured = parseWorksheetRows(rows);
      if (structured.length > 0) return structured;
      return parseTextToDrafts(
        rows
          .map((row) => row.map((cell) => String(cell ?? "")).join(" "))
          .join("\n"),
      );
    }));
    return allDraftGroups.flat();
  }

  throw new Error("暂不支持该文件格式，请使用 Excel、Word(docx)、PDF 或 TXT。");
}

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

function buildQuestionPayload(draft: ImportedDraft, questionBankId: string | null) {
  const contentText = draft.contentText || draft.title;
  const options = draft.type === "choice" ? draft.options : null;
  const answer = (() => {
    if (draft.type === "choice") return { correct: draft.answerText };
    if (draft.type === "true_false") return { correct: /正确|true/i.test(draft.answerText) };
    if (draft.type === "fill_in") return { correct: draft.answerText.split(/[;,；\n]/).map((item) => item.trim()).filter(Boolean) };
    if (draft.type === "code") return { code: draft.answerText };
    return { points: draft.answerText.split(/\n+/).map((item) => item.trim()).filter(Boolean) };
  })();

  return {
    type: draft.type,
    title: draft.title || contentText.slice(0, 120),
    content: { text: contentText, html: `<p>${contentText.replace(/\n/g, "<br />")}</p>` },
    options,
    answer,
    analysis: draft.analysis || null,
    difficulty: draft.difficulty,
    score: 10,
    tag_ids: [],
    knowledge_point_ids: [],
    question_bank_id: questionBankId,
  };
}

export function QuestionImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<ImportedDraft[]>([]);
  const [sourceFileName, setSourceFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [questionBankId, setQuestionBankId] = useState<string>("__none__");
  const [isDragActive, setIsDragActive] = useState(false);

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const invalidCount = useMemo(() => drafts.filter((draft) => draft.issues.length > 0).length, [drafts]);

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

  const processImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请上传 20 MB 以内的文件。`);
      return;
    }
    setLoading(true);
    setParseError(null);
    try {
      const nextDrafts = await extractFileText(file);
      setDrafts(nextDrafts);
      setSourceFileName(file.name);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "文件解析失败");
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await processImportFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const updateDraft = (id: string, patch: Partial<ImportedDraft>) => {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== id) return draft;
        const next = { ...draft, ...patch };
        return buildDraft(next);
      }),
    );
  };

  const deleteDraft = (id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const analyzeAll = async () => {
    const analyzable = drafts.filter((draft) => draft.contentText);
    if (analyzable.length === 0) return;
    setAnalyzingAll(true);
    setParseError(null);
    try {
      const settled = await Promise.allSettled(
        analyzable.map(async (draft) => {
          const result = await questionApiFetch<{ analysis: string; difficulty: number; difficulty_reason: string }>(
            "/api/questions/import/analyze",
            {
              method: "POST",
              body: JSON.stringify({
                question: {
                  title: draft.contentText.replace(/\s+/g, " ").slice(0, 120),
                  type: draft.type,
                  content_text: draft.contentText,
                  options: Object.keys(draft.options).length > 0 ? draft.options : null,
                  answer_text: draft.answerText || null,
                },
              }),
            },
          );
          return { id: draft.id, ...result };
        }),
      );

      const succeeded = settled
        .filter((r): r is PromiseFulfilledResult<{ id: string; analysis: string; difficulty: number; difficulty_reason: string }> => r.status === "fulfilled")
        .map((r) => r.value);

      const failedCount = settled.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        setParseError(`AI 分析完成，其中 ${failedCount} 道题分析失败，已跳过。`);
      }

      setDrafts((current) =>
        current.map((draft) => {
          const match = succeeded.find((item) => item.id === draft.id);
          return match
            ? {
                ...draft,
                aiAnalysis: match.analysis,
                aiDifficulty: match.difficulty,
                aiDifficultyReason: match.difficulty_reason,
              }
            : draft;
        }),
      );
    } finally {
      setAnalyzingAll(false);
    }
  };

  const importAll = async () => {
    const readyDrafts = drafts.filter((draft) => draft.issues.length === 0);
    if (readyDrafts.length === 0) {
      setParseError("没有可导入的题目");
      return;
    }
    setImporting(true);
    setParseError(null);
    try {
      const bankId = questionBankId === "__none__" ? null : questionBankId;
      await questionApiFetch<{ created: number }>("/api/questions/bulk", {
        method: "POST",
        body: JSON.stringify({
          questions: readyDrafts.map((draft) => buildQuestionPayload(draft, bankId)),
        }),
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">导入题目</h1>
          <p className="mt-1 text-sm text-muted-foreground">支持 Excel、Word、PDF、TXT，先预览再导入。</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/questions")} type="button">
          <ArrowLeft className="h-4 w-4" />
          返回题目列表
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
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
                accept=".xlsx,.xls,.docx,.pdf,.txt"
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
                  <Upload className="h-5 w-5" />
                </div>
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-medium text-foreground">拖拽文件到这里，或点击上传</p>
                  <p className="text-xs text-muted-foreground">支持 Excel、Word、PDF、TXT</p>
                </div>
              </button>
              <p className="text-xs text-muted-foreground">Word 默认按 `.docx` 处理。</p>
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

            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                <span>当前文件：{sourceFileName || "未选择文件"}</span>
              </div>
              <p className="mt-2">已识别 {drafts.length} 道题，其中异常 {invalidCount} 道。</p>
            </div>

            {parseError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {parseError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button disabled={drafts.length === 0 || analyzingAll} onClick={() => void analyzeAll()} type="button" variant="secondary">
                {analyzingAll ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                AI 分析全部题目
              </Button>
              <Button disabled={drafts.length === 0 || importing} onClick={() => void importAll()} type="button">
                {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                确认导入可用题目
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {loading && (
            <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              <LoaderCircle className="mx-auto mb-3 h-5 w-5 animate-spin" />
              正在解析文件...
            </div>
          )}

          {!loading && drafts.length === 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              上传文件后会在这里生成预览。无法完整识别的题目会用红色标识。
            </div>
          )}

          {drafts.map((draft, index) => (
            <Card key={draft.id} className={draft.issues.length > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={draft.issues.length > 0 ? "destructive" : "secondary"}>#{index + 1}</Badge>
                    <Badge variant={draft.issues.length > 0 ? "destructive" : "outline"}>
                      {typeOptions.find((item) => item.value === draft.type)?.label ?? draft.type}
                    </Badge>
                    {draft.issues.length > 0 && (
                      <Badge variant="destructive">
                        <AlertCircle className="mr-1 h-3 w-3" />
                        识别异常
                      </Badge>
                    )}
                  </div>
                  <Button className="text-destructive" onClick={() => deleteDraft(draft.id)} size="icon" type="button" variant="ghost">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {draft.issues.length > 0 && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {draft.issues.join("；")}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-end">
                  <div className="w-full max-w-[140px] space-y-2">
                    <Label>题型</Label>
                    <Select value={draft.type} onValueChange={(value) => updateDraft(draft.id, { type: value as QuestionType })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {typeOptions.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>题目内容</Label>
                  <Textarea className="min-h-[92px]" value={draft.contentText} onChange={(event) => updateDraft(draft.id, { contentText: event.target.value })} />
                </div>

                {draft.type === "choice" && (
                  <div className="space-y-2">
                    <Label>选项</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      {Object.entries(draft.options).map(([key, value]) => (
                        <Input
                          key={key}
                          value={`${key}. ${value}`}
                          onChange={(event) => {
                            const nextValue = event.target.value.replace(/^[A-H][\.．、\)]\s*/i, "");
                            updateDraft(draft.id, {
                              options: { ...draft.options, [key]: nextValue },
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                  <div className="space-y-2">
                    <Label>答案</Label>
                    <Textarea value={draft.answerText} onChange={(event) => updateDraft(draft.id, { answerText: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>难度</Label>
                    <Select value={String(draft.difficulty)} onValueChange={(value) => updateDraft(draft.id, { difficulty: Number(value) })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {difficultyOptions.map((item) => (
                          <SelectItem key={item.value} value={String(item.value)}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>题目解析</Label>
                  <Textarea value={draft.analysis} onChange={(event) => updateDraft(draft.id, { analysis: event.target.value })} />
                </div>

                {draft.aiAnalysis && (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300">
                        <Sparkles className="h-4 w-4" />
                        AI 题目解析
                      </div>
                      <p className="text-sm leading-6 text-sky-900 dark:text-sky-100">{draft.aiAnalysis}</p>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">AI 难度建议</p>
                        <p className="mt-2 text-lg font-semibold text-amber-900 dark:text-amber-100">
                          {difficultyOptions.find((item) => item.value === draft.aiDifficulty)?.label ?? `难度 ${draft.aiDifficulty ?? "-"}`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/80 p-3 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/20">
                        <p className="text-xs font-medium text-fuchsia-700 dark:text-fuchsia-300">建议理由</p>
                        <p className="mt-2 text-sm leading-6 text-fuchsia-900 dark:text-fuchsia-100">{draft.aiDifficultyReason}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
