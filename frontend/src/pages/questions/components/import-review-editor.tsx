import { AlertTriangle, Bot, CheckCircle2, Pencil, RotateCcw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RichContent } from "@/components/ui/rich-content";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@/types";
import type { QuestionImportDraft } from "../import-types";
import { getBlockingImportIssues, importTextToHtml, isMissingAnswerIssue } from "../import-utils";

const typeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: "choice", label: "选择题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

export function ImportReviewEditor({
  draft,
  isRecognizing,
  isAnalyzingDocument,
  canApproveAll,
  onChange,
  onApprove,
  onApproveAll,
  onReRecognize,
  onAnalyzeDocument,
  onEditSource,
}: {
  draft: QuestionImportDraft | null;
  isRecognizing: boolean;
  isAnalyzingDocument: boolean;
  canApproveAll: boolean;
  onChange: (patch: Partial<QuestionImportDraft>) => void;
  onApprove: () => void;
  onApproveAll: () => void;
  onReRecognize: () => void;
  onAnalyzeDocument: () => void;
  onEditSource: () => void;
}) {
  if (!draft) {
    return (
      <div className="flex h-[600px] flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-slate-200 bg-white/50 text-center p-12">
        <div className="size-16 rounded-[24px] bg-slate-100 flex items-center justify-center text-slate-300 mb-6 rotate-3">
          <Settings2 size={32} />
        </div>
        <h3 className="text-base font-black text-slate-900 mb-2">等待审核</h3>
        <p className="max-w-[280px] text-sm font-medium text-slate-500 leading-relaxed">
          请从左侧列表中选择一道题目进行审核，AI 已为您预先识别了题型和内容。
        </p>
      </div>
    );
  }

  const blockingIssues = getBlockingImportIssues(draft);
  const hasBlockingIssues = blockingIssues.length > 0;
  const hasMissingAnswer = !draft.answer_text?.trim() || draft.issues.some(isMissingAnswerIssue);

  return (
    <div className="grid w-full gap-5 animate-in fade-in slide-in-from-bottom-3 duration-300 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:p-6">
        <div className="space-y-7">
          <section className="space-y-3">
            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">题型</Label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onChange({ type: item.value })}
                  className={cn(
                    "h-8 rounded-full border px-4 text-xs font-bold transition-all",
                    draft.type === item.value
                      ? "border-primary bg-primary text-white shadow-sm shadow-primary/20"
                      : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200 hover:bg-white",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">题目内容</Label>
            <Textarea
              className="min-h-[220px] w-full rounded-2xl border-slate-200 bg-white p-5 text-sm font-semibold leading-relaxed shadow-sm focus-visible:ring-1 focus-visible:ring-primary/20"
              value={draft.content_text}
              placeholder="请输入题干内容..."
              onChange={(event) => onChange({ content_text: event.target.value })}
            />

            {/<img\s/i.test(draft.content_text) && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">图片预览</p>
                <RichContent html={importTextToHtml(draft.content_text)} />
              </div>
            )}
          </section>

          {draft.type === "choice" && (
            <section className="space-y-3">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">选项</Label>
              <div className="grid gap-3 md:grid-cols-2">
                {["A", "B", "C", "D"].map((key) => (
                  <div key={key} className="group relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-300 transition-colors group-focus-within:text-primary">
                      {key}
                    </div>
                    <Input
                      className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm font-bold shadow-sm focus-visible:ring-1 focus-visible:ring-primary/20"
                      value={draft.options?.[key] ?? ""}
                      placeholder={`选项 ${key} 内容...`}
                      onChange={(event) =>
                        onChange({
                          options: {
                            ...(draft.options ?? {}),
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <Separator className="bg-slate-100" />

          <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">答案</Label>
              <Textarea
                className="min-h-[120px] rounded-2xl border-slate-200 bg-white p-5 text-sm font-semibold shadow-sm focus-visible:ring-1 focus-visible:ring-primary/20"
                value={draft.answer_text ?? ""}
                placeholder="请输入正确答案..."
                onChange={(event) => onChange({ answer_text: event.target.value })}
              />
            </div>

            <div className="space-y-3">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">解析</Label>
              <Textarea
                className="min-h-[120px] rounded-2xl border-slate-200 bg-white p-5 text-sm font-semibold shadow-sm focus-visible:ring-1 focus-visible:ring-primary/20"
                value={draft.analysis ?? ""}
                placeholder="请输入题目解析..."
                onChange={(event) => onChange({ analysis: event.target.value })}
              />
            </div>
          </section>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <Button
            onClick={onApprove}
            disabled={hasBlockingIssues}
            className="h-10 w-full rounded-xl text-sm font-bold shadow-sm shadow-primary/20"
          >
            <CheckCircle2 size={15} className="mr-2" />
            确认并下一题
          </Button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isRecognizing}
              onClick={onReRecognize}
              className="h-9 rounded-lg border-none bg-indigo-50 text-sm font-bold text-indigo-600 hover:bg-indigo-100"
            >
              {isRecognizing ? <RotateCcw size={14} className="mr-2 animate-spin" /> : <Bot size={14} className="mr-2" />}
              AI 补全
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isAnalyzingDocument}
              className="h-9 rounded-lg border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={onAnalyzeDocument}
            >
              {isAnalyzingDocument ? <RotateCcw size={14} className="mr-2 animate-spin" /> : <Bot size={14} className="mr-2" />}
              AI 一键分析
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canApproveAll}
              className="h-9 rounded-lg border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={onApproveAll}
            >
              <CheckCircle2 size={14} className="mr-2" />
              确定全部
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">难度系数</Label>
          <div className="mt-3 grid h-10 grid-cols-5 items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-1.5">
            {[1, 2, 3, 4, 5].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => onChange({ difficulty: val })}
                className={cn(
                  "h-7 rounded-lg text-xs font-black transition-all",
                  draft.difficulty === val ? "bg-white text-primary shadow-sm" : "text-slate-400 hover:text-slate-600",
                )}
              >
                {val}
              </button>
            ))}
          </div>
        </div>

        {hasBlockingIssues && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="text-sm font-bold">异常，暂不能导入</p>
            </div>
            <ul className="space-y-1">
              {blockingIssues.map((issue) => (
                <li key={issue} className="text-sm font-medium leading-relaxed">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasMissingAnswer && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-amber-700">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <p className="text-sm font-bold">缺答案，可继续导入</p>
            </div>
            <p className="text-sm font-medium leading-relaxed">
              这类题可以先入库，之后再补充答案。
            </p>
          </div>
        )}

        <details className="group overflow-hidden rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-600">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-slate-300 transition-colors group-open:bg-primary" />
              原文内容
            </span>
            <button
              type="button"
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEditSource();
              }}
            >
              <Pencil className="size-3" />
              编辑
            </button>
          </summary>
          <div className="mt-2 max-h-[320px] overflow-auto border-t border-slate-100 px-3 py-4">
            <pre className="whitespace-pre-wrap font-mono text-xs font-medium leading-relaxed text-slate-500">
              {draft.raw_text}
            </pre>
          </div>
        </details>
      </aside>
    </div>
  );
}
