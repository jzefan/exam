import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function TrueFalseQuestion({ question, answer, onChange }: Props) {
  const selected = answer?.value as boolean | undefined;

  const options: { value: boolean; label: string; sub: string }[] = [
    { value: true, label: "A", sub: "正确" },
    { value: false, label: "B", sub: "错误" },
  ];

  return (
    <div className="space-y-5">
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{
          __html:
            (question.content as { text?: string }).text ?? question.title,
        }}
      />

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange({ value: opt.value })}
              className={`group relative flex items-center gap-3.5 px-5 py-4 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? "border-foreground bg-foreground/[0.03]"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              {/* Letter circle */}
              <span
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  isSelected
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground group-hover:bg-foreground/10"
                }`}
              >
                {opt.label}
              </span>
              <span
                className={`text-sm font-medium ${
                  isSelected ? "text-foreground" : "text-foreground/70"
                }`}
              >
                {opt.sub}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
