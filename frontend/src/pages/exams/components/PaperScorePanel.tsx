import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { QuestionType } from "@/types";
import { cn } from "@/lib/utils";

import type { ExamQuestionFormItem } from "./exam-form-utils";
import type { PaperPreviewItem, QuestionTypeSummary } from "./paper-view-utils";
import { buildQuestionJumpGroups, questionTypeLabels } from "./paper-view-utils";

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
  title = "考试分数",
  description = "支持逐题微调，也可以按题型设置总分并均分到每题。",
  saveLabel = "保存分数",
  compact = false,
  onJumpToQuestion,
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
  title?: string;
  description?: string;
  saveLabel?: string;
  compact?: boolean;
  onJumpToQuestion?: (questionId: string) => void;
}) {
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.question.id, item])),
    [items],
  );
  const scoreItemMap = useMemo(
    () => new Map(questionItems.map((item) => [item.question_id, item])),
    [questionItems],
  );
  const orderedItems = useMemo(
    () => questionItems.slice().sort((a, b) => a.order - b.order),
    [questionItems],
  );
  const displayIndexByQuestionId = useMemo(
    () =>
      new Map(
        orderedItems.map((item, index) => [item.question_id, index + 1]),
      ),
    [orderedItems],
  );
  const jumpGroups = useMemo(
    () => buildQuestionJumpGroups(items, questionTypeSummaries),
    [items, questionTypeSummaries],
  );

  const renderScoreTile = ({
    questionId,
    displayIndex,
    active = false,
  }: {
    questionId: string;
    displayIndex: number;
    active?: boolean;
  }) => {
    const item = scoreItemMap.get(questionId);
    if (!item) return null;
    return (
      <div
        key={questionId}
        className={cn(
          "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border/70 bg-background p-2",
          active && "border-primary/50 bg-primary/5",
        )}
      >
        <Button
          type="button"
          variant={active ? "default" : "outline"}
          className="h-10 px-0 text-sm tabular-nums"
          onClick={() => onJumpToQuestion?.(questionId)}
          aria-label={`跳转到第 ${displayIndex} 题`}
        >
          {String(displayIndex).padStart(2, "0")}
        </Button>
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            aria-label={`第 ${displayIndex} 题分数`}
            type="number"
            min={0}
            step="0.5"
            value={item.score_override ?? ""}
            onChange={(event) => onQuestionScoreChange(questionId, event.target.value)}
            className="h-10 min-w-0 text-center text-sm"
          />
          <span className="shrink-0 text-sm text-muted-foreground">分</span>
        </div>
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          卷面总分 {Number(totalScore.toFixed(2)).toString()} 分
        </Badge>
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

      {compact ? (
        mode === "order" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {orderedItems.map((item, index) =>
              renderScoreTile({
                questionId: item.question_id,
                displayIndex: index + 1,
              }),
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {jumpGroups.map((group) => (
              <section key={group.summary.type} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {questionTypeLabels[group.summary.type]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      共 {group.summary.count} 题 · 合计 {group.summary.totalScore} 分
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      aria-label={`${questionTypeLabels[group.summary.type]}题型总分`}
                      className="h-9 w-24 text-center"
                      type="number"
                      min={0}
                      step="0.5"
                      value={typeScoreDrafts[group.summary.type] ?? ""}
                      onChange={(event) => onTypeDraftChange(group.summary.type, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onApplyTypeScore(group.summary)}
                    >
                      均分
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.items.map((item) =>
                    renderScoreTile({
                      questionId: item.previewItem.question.id,
                      displayIndex:
                        displayIndexByQuestionId.get(item.previewItem.question.id) ??
                        item.displayIndex,
                    }),
                  )}
                </div>
              </section>
            ))}
          </div>
        )
      ) : mode === "order" ? (
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
        {saving ? "保存中..." : saveLabel}
      </Button>
    </section>
  );
}
