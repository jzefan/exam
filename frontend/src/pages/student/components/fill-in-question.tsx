import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function FillInQuestion({ question, answer, onChange }: Props) {
  const content = question.content as {
    text?: string;
    blank_count?: number;
  };
  const blankCount = content.blank_count ?? 1;
  const blanks = (answer?.blanks as string[]) ?? Array(blankCount).fill("");

  const updateBlank = (index: number, value: string) => {
    const next = [...blanks];
    while (next.length <= index) next.push("");
    next[index] = value;
    onChange({ blanks: next });
  };

  return (
    <div className="space-y-6">
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{
          __html: content.text ?? question.title,
        }}
      />

      <div className="space-y-3">
        {Array.from({ length: blankCount }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="shrink-0 w-14 text-right text-xs font-medium text-muted-foreground tabular-nums">
              空 {i + 1}
            </span>
            <div className="flex-1 relative">
              <input
                type="text"
                value={blanks[i] ?? ""}
                onChange={(e) => updateBlank(i, e.target.value)}
                placeholder={`填写第 ${i + 1} 空`}
                className="w-full border-0 border-b-2 border-border bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
