import type { IExamQuestionForStudent } from "@/types";
import { X } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  true_false: "判断题",
  choice: "选择题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

interface Props {
  questions: IExamQuestionForStudent[];
  answers: Record<string, Record<string, unknown>>;
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

function isAnswered(ans: Record<string, unknown> | undefined): boolean {
  if (!ans) return false;
  return Object.values(ans).some((v) =>
    Array.isArray(v)
      ? v.length > 0 && v.some(Boolean)
      : v !== "" && v !== null && v !== undefined,
  );
}

export function QuestionNav({
  questions,
  answers,
  currentIndex,
  onNavigate,
  onClose,
}: Props) {
  // Group by type, preserving order of first appearance
  const typeOrder: string[] = [];
  for (const q of questions) {
    if (!typeOrder.includes(q.type)) typeOrder.push(q.type);
  }

  const groups = typeOrder.map((type) => ({
    type,
    label: TYPE_LABELS[type] ?? type,
    items: questions
      .map((q, index) => ({ index, q }))
      .filter(({ q }) => q.type === type),
  }));

  const answeredCount = questions.filter((q) =>
    isAnswered(answers[q.question_id]),
  ).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <p className="text-sm font-semibold text-foreground">答题卡</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {answeredCount} / {questions.length} 已答
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-foreground/40 transition-all duration-500"
          style={{
            width: `${questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}%`,
          }}
        />
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group.type}>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              {group.label}
              <span className="ml-1.5 opacity-60">{group.items.length}</span>
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {group.items.map(({ index, q }) => {
                const answered = isAnswered(answers[q.question_id]);
                const isCurrent = index === currentIndex;
                return (
                  <button
                    key={q.question_id}
                    onClick={() => {
                      onNavigate(index);
                      onClose();
                    }}
                    className={`relative w-full aspect-square rounded-lg text-xs font-semibold tabular-nums transition-all ${
                      isCurrent
                        ? "bg-foreground text-background ring-2 ring-foreground ring-offset-2 ring-offset-background"
                        : answered
                          ? "bg-foreground/10 text-foreground"
                          : "bg-muted text-muted-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-foreground" />
          当前
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-foreground/10" />
          已答
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-muted" />
          未答
        </span>
      </div>
    </div>
  );
}
