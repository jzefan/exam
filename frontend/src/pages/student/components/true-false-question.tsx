import { cn } from "@/lib/utils";
import { renderLatexInHtml } from "@/components/ui/latex-text";
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
          __html: renderLatexInHtml(
            (question.content as { text?: string }).text ?? question.title,
          ),
        }}
      />

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange({ value: opt.value })}
              className={cn(
                "group relative flex items-center gap-3.5 rounded-xl border-2 px-5 py-4 text-left transition-colors",
                isSelected
                  ? "border-primary/50 bg-secondary text-secondary-foreground shadow-sm"
                  : "border-border bg-background hover:border-primary/20 hover:bg-accent/40",
              )}
            >
              {/* Letter circle */}
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground",
                )}
              >
                {opt.label}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  isSelected ? "text-secondary-foreground" : "text-foreground/70",
                )}
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
