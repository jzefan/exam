import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  QuestionPreviewCard,
  DIFFICULTY_LABELS,
} from "@/components/questions/question-preview-card";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@/types";

import { ExamQuestionActions } from "./ExamQuestionActions";
import type { PaperPreviewItem, QuestionTypeSummary } from "./paper-view-utils";
import { questionTypeLabels } from "./paper-view-utils";
import type { ScoreViewMode } from "./PaperScorePanel";

export function PaperPreview({
  title,
  categoryLabel,
  items,
  scoreMode,
  onScoreModeChange,
  questionTypeSummaries,
  typeScoreDrafts,
  onTypeScoreChange,
  onQuestionScoreChange,
  onReplaceQuestion,
  className,
}: {
  title: string;
  categoryLabel: string;
  items: PaperPreviewItem[];
  scoreMode: ScoreViewMode;
  onScoreModeChange: (mode: ScoreViewMode) => void;
  questionTypeSummaries: QuestionTypeSummary[];
  typeScoreDrafts: Partial<Record<QuestionType, string>>;
  onTypeScoreChange: (summary: QuestionTypeSummary, value: string) => void;
  onQuestionScoreChange: (questionId: string, value: string) => void;
  onReplaceQuestion?: (oldId: string, newId: string) => void;
  className?: string;
}) {
  const currentExamQuestionIds = items.map((item) => item.question.id);
  const nextMode = scoreMode === "order" ? "type" : "order";
  const nextModeLabel = nextMode === "type" ? "按题型展示" : "按顺序展示";

  const groupedItems =
    scoreMode === "type"
      ? questionTypeSummaries
          .map((summary) => ({
            summary,
            items: items.filter((item) =>
              summary.questionIds.includes(item.question.id),
            ),
          }))
          .filter((group) => group.items.length > 0)
      : [];

  return (
    <div className={cn("space-y-5", className)}>
      <div className="relative rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="absolute right-0 top-0">
          <div className="overflow-hidden rounded-tr-2xl">
            <button
              type="button"
              onClick={() => onScoreModeChange(nextMode)}
              className="relative flex h-12 min-w-[172px] items-center justify-center bg-primary/12 px-8 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary/16"
              style={{
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 16% 100%)",
              }}
            >
              <span className="relative z-10">{nextModeLabel}</span>
            </button>
          </div>
        </div>

        <div className="space-y-2 border-b border-dashed border-border/70 pb-5 text-center">
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline">{categoryLabel}</Badge>
            <span className="text-xs font-medium text-muted-foreground">
              标准试卷预览
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
        </div>

        <div className="mt-6 space-y-6">
          <div className="min-h-3 pr-[190px]" />

          {scoreMode === "type"
            ? groupedItems.map(({ summary, items: groupedQuestions }) => (
                <section key={summary.type} className="space-y-4">
                  <div className="w-full border-b border-primary/20 bg-gradient-to-r from-primary/12 via-primary/8 to-transparent px-4 py-2.5">
                    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-left">
                      <span className="text-base font-semibold text-foreground">
                        {questionTypeLabels[summary.type]}
                      </span>
                      <span className="text-base font-semibold text-primary">
                        {summary.count}
                      </span>
                      <span className="text-base font-semibold text-foreground">
                        题，
                      </span>
                      <span className="text-base font-semibold text-foreground">
                        共
                      </span>
                      <Input
                        className="h-8 w-24 border-primary/20 bg-background/90 px-2 text-center text-sm font-medium"
                        type="number"
                        min={0}
                        step="0.5"
                        value={typeScoreDrafts[summary.type] ?? ""}
                        onChange={(event) =>
                          onTypeScoreChange(summary, event.target.value)
                        }
                      />
                      <span className="text-base font-semibold text-foreground">
                        分
                      </span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {groupedQuestions.map((item, index) => (
                      <section key={item.question.id} className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-semibold">
                              第 {index + 1} 题
                            </Badge>
                            <span className="text-sm font-medium text-muted-foreground">
                              {questionTypeLabels[item.question.type] ?? "题目"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {DIFFICULTY_LABELS[item.question.difficulty] ??
                                item.question.difficulty}
                            </span>
                            {item.question.knowledge_points.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {item.question.knowledge_points
                                  .map((kp) => kp.name)
                                  .join(" · ")}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {onReplaceQuestion && (
                              <ExamQuestionActions
                                question={item.question}
                                currentExamQuestionIds={currentExamQuestionIds}
                                onReplaceQuestion={onReplaceQuestion}
                              />
                            )}
                            <span className="text-sm font-semibold text-foreground">
                              分数
                            </span>
                            <Input
                              className="h-8 w-20"
                              type="number"
                              min={0}
                              step="0.5"
                              value={item.scoreOverride ?? ""}
                              onChange={(event) =>
                                onQuestionScoreChange(
                                  item.question.id,
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                        </div>

                        <QuestionPreviewCard
                          question={item.question}
                          mode="detailed"
                          defaultExpanded
                          hideHeader
                          hideMeta
                          markChoiceAnswer
                          className="rounded-2xl border-border/60 bg-background p-5"
                        />
                      </section>
                    ))}
                  </div>
                </section>
              ))
            : items.map((item, index) => (
                <section key={item.question.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-semibold">
                        第 {index + 1} 题
                      </Badge>
                      <span className="text-sm font-medium text-muted-foreground">
                        {questionTypeLabels[item.question.type] ?? "题目"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {DIFFICULTY_LABELS[item.question.difficulty] ??
                          item.question.difficulty}
                      </span>
                      {item.question.knowledge_points.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.question.knowledge_points
                            .map((kp) => kp.name)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {onReplaceQuestion && (
                        <ExamQuestionActions
                          question={item.question}
                          currentExamQuestionIds={currentExamQuestionIds}
                          onReplaceQuestion={onReplaceQuestion}
                        />
                      )}
                      <span className="text-sm font-semibold text-foreground">
                        分数
                      </span>
                      <Input
                        className="h-8 w-20"
                        type="number"
                        min={0}
                        step="0.5"
                        value={item.scoreOverride ?? ""}
                        onChange={(event) =>
                          onQuestionScoreChange(
                            item.question.id,
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  </div>

                  <QuestionPreviewCard
                    question={item.question}
                    mode="detailed"
                    defaultExpanded
                    hideHeader
                    hideMeta
                    markChoiceAnswer
                    className="rounded-2xl border-border/60 bg-background p-5"
                  />
                </section>
              ))}
        </div>
      </div>
    </div>
  );
}
