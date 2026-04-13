import { cn } from "@/lib/utils";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function ChoiceQuestion({ question, answer, onChange }: Props) {
  const options = question.options as Record<string, string> | null;
  const selected = (answer?.selected as string[]) ?? [];
  const isMulti = (question.content as { multi?: boolean }).multi === true;

  if (!options) {
    return (
      <p className="text-sm text-muted-foreground">题目选项数据缺失</p>
    );
  }

  const toggle = (key: string) => {
    if (isMulti) {
      const next = selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key];
      onChange({ selected: next });
    } else {
      onChange({ selected: [key] });
    }
  };

  const sortedOptions = Object.entries(options).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div
          className="prose prose-sm dark:prose-invert max-w-none leading-relaxed flex-1"
          dangerouslySetInnerHTML={{
            __html: renderLatexInHtml(
              (question.content as { text?: string }).text ?? question.title,
            ),
          }}
        />
        {isMulti && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-md">
            多选
          </span>
        )}
      </div>

      <div className="space-y-2">
        {sortedOptions.map(([key, text]) => {
          const isSelected = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(key)}
              className={cn(
                "group flex w-full items-start gap-3.5 rounded-xl border-2 px-4 py-3.5 text-left transition-colors",
                isSelected
                  ? "border-primary/50 bg-secondary text-secondary-foreground shadow-sm"
                  : "border-border bg-background hover:border-primary/20 hover:bg-accent/40",
              )}
            >
              {/* Letter indicator */}
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground",
                )}
              >
                {key}
              </span>
              <span
                className={cn(
                  "pt-0.5 text-sm leading-relaxed",
                  isSelected ? "text-secondary-foreground" : "text-foreground/70",
                )}
                dangerouslySetInnerHTML={{ __html: renderLatexInHtml(text) }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
