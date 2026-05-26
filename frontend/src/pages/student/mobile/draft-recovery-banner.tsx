import { useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { RotateCcw, X } from "lucide-react";
import type { IExamQuestionForStudent } from "@/types";

export interface DivergedQuestion {
  questionId: string;
  order: number;
  title: string;
  localAnswer: Record<string, unknown>;
  serverAnswer: Record<string, unknown> | undefined;
}

interface DraftRecoveryBannerProps {
  diverged: DivergedQuestion[];
  questions: IExamQuestionForStudent[];
  onApplyAll: (answers: Record<string, Record<string, unknown>>) => void;
  onDismiss: () => void;
}

function answerSummary(ans: Record<string, unknown> | undefined): string {
  if (!ans) return "（无）";
  const vals = Object.values(ans).filter((v) => v !== "" && v !== null && v !== undefined);
  if (vals.length === 0) return "（空）";
  const first = vals[0];
  if (typeof first === "string") return first.slice(0, 40) + (first.length > 40 ? "…" : "");
  if (Array.isArray(first)) return first.join(", ");
  return JSON.stringify(first).slice(0, 40);
}

export function DraftRecoveryBanner({
  diverged,
  questions,
  onApplyAll,
  onDismiss,
}: DraftRecoveryBannerProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(diverged.map((d) => d.questionId)));

  const handleApplyAll = () => {
    const toApply: Record<string, Record<string, unknown>> = {};
    for (const d of diverged) {
      toApply[d.questionId] = d.localAnswer;
    }
    onApplyAll(toApply);
    onDismiss();
  };

  const handleApplySelected = () => {
    const toApply: Record<string, Record<string, unknown>> = {};
    for (const d of diverged) {
      if (selected.has(d.questionId)) {
        toApply[d.questionId] = d.localAnswer;
      }
    }
    onApplyAll(toApply);
    setReviewOpen(false);
    onDismiss();
  };

  const toggleSelect = (qid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const questionMap = new Map(questions.map((q) => [q.question_id, q]));

  return (
    <>
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 text-sm">
        <RotateCcw className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="flex-1 text-amber-800">
          在此设备上找到 {diverged.length} 道题的本地草稿未同步
        </span>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 border-amber-300 text-amber-800"
          onClick={() => setReviewOpen(true)}
        >
          逐题确认
        </Button>
        <Button
          size="sm"
          className="text-xs h-7 bg-amber-600 hover:bg-amber-700 text-white"
          onClick={handleApplyAll}
        >
          全部恢复
        </Button>
        <button onClick={onDismiss} className="text-amber-500 hover:text-amber-700 ml-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Drawer.Root open={reviewOpen} onOpenChange={setReviewOpen} dismissible>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-background max-h-[90dvh]">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b">
              <Drawer.Title className="text-base font-semibold">
                选择要恢复的草稿答案
              </Drawer.Title>
              <button onClick={() => setReviewOpen(false)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
              {diverged.map((d) => {
                const q = questionMap.get(d.questionId);
                const num = q?.order ?? 0;
                const isChecked = selected.has(d.questionId);
                return (
                  <div
                    key={d.questionId}
                    className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                      isChecked ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => toggleSelect(d.questionId)}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(d.questionId)}
                        className="mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium mb-1">第 {num} 题</p>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>
                            <span className="text-amber-600">本地草稿：</span>
                            {answerSummary(d.localAnswer)}
                          </div>
                          {d.serverAnswer && Object.keys(d.serverAnswer).length > 0 && (
                            <div>
                              <span className="text-muted-foreground">服务器：</span>
                              {answerSummary(d.serverAnswer)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setReviewOpen(false);
                  onDismiss();
                }}
              >
                忽略草稿
              </Button>
              <Button
                className="flex-1"
                disabled={selected.size === 0}
                onClick={handleApplySelected}
              >
                恢复选中 ({selected.size})
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
