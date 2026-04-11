import { Bot, CheckCircle2, RotateCcw, SkipForward } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RichContent } from "@/components/ui/rich-content";
import type { QuestionType } from "@/types";
import type { QuestionImportDraft } from "../import-types";
import { getQuestionTypeLabel, getReviewStatusLabel, importTextToHtml } from "../import-utils";

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
  onChange,
  onApprove,
  onSkip,
  onReRecognize,
}: {
  draft: QuestionImportDraft | null;
  isRecognizing: boolean;
  onChange: (patch: Partial<QuestionImportDraft>) => void;
  onApprove: () => void;
  onSkip: () => void;
  onReRecognize: () => void;
}) {
  if (!draft) {
    return (
      <section className="flex min-h-[560px] items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
        请选择左侧题目进行审核
      </section>
    );
  }

  const optionEntries = Object.entries(draft.options ?? {});

  return (
    <section className="min-h-full rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{getReviewStatusLabel(draft.review_status)}</Badge>
          <Badge variant="outline">{getQuestionTypeLabel(draft.type)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={isRecognizing} onClick={onReRecognize}>
            {isRecognizing ? <RotateCcw size={14} className="animate-spin" /> : <Bot size={14} />}
            AI 补全当前题
          </Button>
          <Button type="button" size="sm" onClick={onApprove}>
            <CheckCircle2 size={14} />
            确认当前题
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onSkip}>
            <SkipForward size={14} />
            跳过该题
          </Button>
        </div>
      </div>

      <div className="py-4">
        <div className="max-w-[220px] space-y-2">
          <Label>题型</Label>
          <Select value={draft.type} onValueChange={(value) => onChange({ type: value as QuestionType })}>
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

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>题目内容</Label>
          <Textarea
            className="min-h-[140px]"
            value={draft.content_text}
            onChange={(event) => onChange({ content_text: event.target.value })}
          />
          {/<img\s/i.test(draft.content_text) ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">图片预览</p>
              <RichContent html={importTextToHtml(draft.content_text)} />
            </div>
          ) : null}
        </div>

        {draft.type === "choice" ? (
          <div className="space-y-2">
            <Label>选项</Label>
            <div className="grid gap-2 md:grid-cols-2">
              {["A", "B", "C", "D"].map((key) => (
                <Input
                  key={key}
                  value={draft.options?.[key] ?? ""}
                  placeholder={`选项 ${key}`}
                  onChange={(event) =>
                    onChange({
                      options: {
                        ...(draft.options ?? {}),
                        [key]: event.target.value,
                      },
                    })
                  }
                />
              ))}
            </div>
            {optionEntries.length > 4 ? (
              <p className="text-xs text-muted-foreground">
                还识别到额外选项：{optionEntries.slice(4).map(([key]) => key).join("、")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
          <div className="space-y-2">
            <Label>答案</Label>
            <Textarea
              className="min-h-[96px]"
              value={draft.answer_text ?? ""}
              onChange={(event) => onChange({ answer_text: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>难度</Label>
            <Select
              value={String(draft.difficulty)}
              onValueChange={(value) => onChange({ difficulty: Number(value) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>分析</Label>
          <Textarea
            className="min-h-[96px]"
            value={draft.analysis ?? ""}
            onChange={(event) => onChange({ analysis: event.target.value })}
          />
        </div>

        {draft.issues.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">需要人工确认</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {draft.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="rounded-lg border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">查看原始文本</summary>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">{draft.raw_text}</pre>
        </details>
      </div>
    </section>
  );
}
