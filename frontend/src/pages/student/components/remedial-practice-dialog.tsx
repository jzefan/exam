import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getStudentLocale, tStudent } from "../i18n";
import {
  distributePracticeCounts,
  getWrongAnswerCategoryLabel,
  type IRemedialPracticeAnalysis,
} from "../wrong-answer-shared";

const FALLBACK_TOTAL = 10;
const HARD_MAX_TOTAL = 50;

function readErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "";
}

function clampCount(raw: string): number {
  const next = Number.parseInt(raw, 10);
  if (Number.isNaN(next)) return 0;
  return Math.min(Math.max(next, 0), HARD_MAX_TOTAL);
}

export function RemedialPracticeDialog({
  open,
  onOpenChange,
  analysis,
  isAnalysisLoading,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: IRemedialPracticeAnalysis | null;
  isAnalysisLoading: boolean;
  onStarted: (examId: string) => void;
}) {
  const locale = getStudentLocale();
  const [total, setTotal] = useState(FALLBACK_TOTAL);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => analysis?.groups ?? [], [analysis]);
  const sum = useMemo(() => Object.values(counts).reduce((acc, value) => acc + value, 0), [counts]);

  // 每次打开（或分析结果更新）都按默认题数重新分配，避免残留上次的手改值。
  useEffect(() => {
    if (!open || !analysis) return;
    const initialTotal = analysis.default_total_count || FALLBACK_TOTAL;
    setTotal(initialTotal);
    setCounts(distributePracticeCounts(analysis.groups, initialTotal));
    setError("");
  }, [open, analysis]);

  const handleTotalChange = (raw: string) => {
    const next = clampCount(raw);
    setTotal(next);
    setCounts(distributePracticeCounts(groups, next));
  };

  const handleGroupChange = (key: string, raw: string) => {
    const next = clampCount(raw);
    const updated = { ...counts };
    if (next > 0) {
      updated[key] = next;
    } else {
      delete updated[key];
    }
    setCounts(updated);
    setTotal(Object.values(updated).reduce((acc, value) => acc + value, 0));
  };

  const handleSubmit = async () => {
    if (!analysis || sum <= 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await apiClient.post<{ exam_id: string }>("/api/wrong-answers/practice", {
        source_exam_id: analysis.source_exam_id,
        total_count: sum,
        allocations: Object.entries(counts).map(([group_key, count]) => ({ group_key, count })),
      });
      onOpenChange(false);
      onStarted(response.data.exam_id);
    } catch (requestError) {
      setError(
        readErrorMessage(requestError) || tStudent("wrong_answers_practice_failed", undefined, locale),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoryLabel = getWrongAnswerCategoryLabel(analysis?.source_category, locale);

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {tStudent("wrong_answers_practice_cta", undefined, locale)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tStudent("wrong_answers_practice_dialog_desc", { category: categoryLabel }, locale)}
          </DialogDescription>
        </DialogHeader>

        {isSubmitting ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 size={20} className="animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">
              {tStudent("wrong_answers_practice_generating", undefined, locale)}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {tStudent("wrong_answers_practice_points", undefined, locale)}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {tStudent("wrong_answers_practice_sum", { count: sum }, locale)}
                </span>
              </div>

              {isAnalysisLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {tStudent("wrong_answers_empty", undefined, locale)}
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {groups.map((group) => (
                    <div
                      key={group.key}
                      className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-foreground">
                          {group.name}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {tStudent(
                            "wrong_answers_exam_count",
                            { count: group.wrong_question_count },
                            locale,
                          )}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={HARD_MAX_TOTAL}
                        value={counts[group.key] ?? 0}
                        onChange={(event) => handleGroupChange(group.key, event.target.value)}
                        className="h-8 w-16 shrink-0 text-center text-sm"
                        aria-label={`${group.name} ${tStudent("wrong_answers_practice_total", undefined, locale)}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs font-semibold text-foreground">
                {tStudent("wrong_answers_practice_total", undefined, locale)}
              </span>
              <Input
                type="number"
                min={1}
                max={HARD_MAX_TOTAL}
                value={total}
                disabled={isAnalysisLoading || groups.length === 0}
                onChange={(event) => handleTotalChange(event.target.value)}
                className="h-8 w-20 text-center text-sm"
              />
            </div>
          </div>
        )}

        {error && !isSubmitting ? (
          <p className="text-xs font-medium text-destructive">{error}</p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            {tStudent("common_cancel", undefined, locale)}
          </Button>
          <Button
            size="sm"
            disabled={isSubmitting || isAnalysisLoading || sum <= 0}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {tStudent("wrong_answers_practice_submit", undefined, locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
