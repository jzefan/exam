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
            __html:
              (question.content as { text?: string }).text ?? question.title,
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
              onClick={() => toggle(key)}
              className={`group w-full flex items-start gap-3.5 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? "border-foreground bg-foreground/[0.03]"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              {/* Letter indicator */}
              <span
                className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors mt-0.5 ${
                  isSelected
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground group-hover:bg-foreground/10"
                }`}
              >
                {key}
              </span>
              <span
                className={`text-sm leading-relaxed pt-0.5 ${
                  isSelected ? "text-foreground" : "text-foreground/70"
                }`}
              >
                {text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
