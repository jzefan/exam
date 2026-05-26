import { Drawer } from "vaul";
import { cn } from "@/lib/utils";

interface QuestionMapDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: Array<{ question_id: string; type: string }>;
  answers: Record<string, Record<string, unknown>>;
  currentIndex: number;
  onSelectQuestion: (index: number) => void;
}

function isAnswered(ans: Record<string, unknown> | undefined): boolean {
  if (!ans) return false;
  return Object.values(ans).some((v) =>
    Array.isArray(v)
      ? v.length > 0 && v.some(Boolean)
      : v !== "" && v !== null && v !== undefined,
  );
}

const TYPE_SHORT: Record<string, string> = {
  true_false: "判断",
  choice: "选择",
  fill_in: "填空",
  short_answer: "简答",
  essay: "论述",
  code: "编程",
};

export function QuestionMapDrawer({
  open,
  onOpenChange,
  questions,
  answers,
  currentIndex,
  onSelectQuestion,
}: QuestionMapDrawerProps) {
  const firstUnanswered = questions.findIndex((q) => !isAnswered(answers[q.question_id]));

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl bg-background outline-none">
          <div className="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-muted" />
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <Drawer.Title className="text-sm font-semibold">题目导航</Drawer.Title>
            {firstUnanswered >= 0 && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  onSelectQuestion(firstUnanswered);
                  onOpenChange(false);
                }}
              >
                跳至首题未答
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-4" style={{ overscrollBehavior: "contain" }}>
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, index) => {
                const answered = isAnswered(answers[q.question_id]);
                const isCurrent = index === currentIndex;
                return (
                  <button
                    key={q.question_id}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg border p-1.5 text-center transition-colors",
                      isCurrent && "border-primary bg-primary/10",
                      !isCurrent && answered && "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950",
                      !isCurrent && !answered && "border-border bg-muted/30",
                    )}
                    onClick={() => {
                      onSelectQuestion(index);
                      onOpenChange(false);
                    }}
                  >
                    <span className="text-xs font-medium tabular-nums">{index + 1}</span>
                    <span className="text-[9px] text-muted-foreground">
                      {TYPE_SHORT[q.type] ?? q.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-safe-b" style={{ height: "env(safe-area-inset-bottom)" }} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
