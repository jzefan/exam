import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function ShortAnswerQuestion({ question, answer, onChange }: Props) {
  const html = (answer?.html as string) ?? "";

  return (
    <div className="space-y-5">
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{
          __html:
            (question.content as { text?: string }).text ?? question.title,
        }}
      />
      <RichTextEditor
        value={html}
        onChange={(content) => onChange({ html: content })}
        placeholder="请输入答案..."
      />
    </div>
  );
}
