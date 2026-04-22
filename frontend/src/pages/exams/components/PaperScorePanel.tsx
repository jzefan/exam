import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { QuestionType } from "@/types";

import type { ExamQuestionFormItem } from "./exam-form-utils";
import type { PaperPreviewItem, QuestionTypeSummary } from "./paper-view-utils";
import { questionTypeLabels } from "./paper-view-utils";

export type ScoreViewMode = "order" | "type";

export function PaperScorePanel({
  items,
  questionItems,
  mode,
  onModeChange,
  onQuestionScoreChange,
  questionTypeSummaries,
  typeScoreDrafts,
  onTypeDraftChange,
  onApplyTypeScore,
  totalScore,
  dirty,
  saving,
  onSave,
}: {
  items: PaperPreviewItem[];
  questionItems: ExamQuestionFormItem[];
  mode: ScoreViewMode;
  onModeChange: (mode: ScoreViewMode) => void;
  onQuestionScoreChange: (questionId: string, value: string) => void;
  questionTypeSummaries: QuestionTypeSummary[];
  typeScoreDrafts: Partial<Record<QuestionType, string>>;
  onTypeDraftChange: (type: QuestionType, value: string) => void;
  onApplyTypeScore: (summary: QuestionTypeSummary) => void;
  totalScore: number;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.question.id, item])),
    [items],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">考试分数</h3>
          <p className="text-xs text-muted-foreground">支持逐题微调，也可以按题型设置总分并均分到每题。</p>
        </div>
        <Badge variant="secondary">卷面总分 {Number(totalScore.toFixed(2)).toString()} 分</Badge>
      </div>

      <div className="inline-flex rounded-xl border border-border/60 bg-background p-1">
        <Button
          type="button"
          size="sm"
          variant={mode === "order" ? "default" : "ghost"}
          onClick={() => onModeChange("order")}
        >
          按顺序
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "type" ? "default" : "ghost"}
          onClick={() => onModeChange("type")}
        >
          按题型
        </Button>
      </div>

      {mode === "order" ? (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4">
          {questionItems
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((item, index) => {
              const previewItem = itemMap.get(item.question_id);
              if (!previewItem) return null;
              return (
                <div key={item.question_id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      第 {index + 1} 题 · {questionTypeLabels[previewItem.question.type] ?? "题目"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{previewItem.question.title}</p>
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={item.score_override ?? ""}
                      onChange={(event) => onQuestionScoreChange(item.question_id, event.target.value)}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="space-y-4">
          {questionTypeSummaries.map((summary) => (
            <div key={summary.type} className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{questionTypeLabels[summary.type]}</p>
                  <p className="text-xs text-muted-foreground">共 {summary.count} 题，当前合计 {summary.totalScore} 分</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-24"
                    type="number"
                    min={0}
                    step="0.5"
                    value={typeScoreDrafts[summary.type] ?? ""}
                    onChange={(event) => onTypeDraftChange(summary.type, event.target.value)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => onApplyTypeScore(summary)}>
                    均分到每题
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="w-full" disabled={!dirty || saving} onClick={onSave}>
        {saving ? "保存中..." : "保存分数"}
      </Button>
    </section>
  );
}
