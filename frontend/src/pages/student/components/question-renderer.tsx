import type { IExamQuestionForStudent } from "@/types";
import { TrueFalseQuestion } from "./true-false-question";
import { ChoiceQuestion } from "./choice-question";
import { FillInQuestion } from "./fill-in-question";
import { ShortAnswerQuestion } from "./short-answer-question";
import { EssayQuestion } from "./essay-question";
import { CodeQuestion } from "./code-question";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

const COMPONENTS: Record<string, React.ComponentType<Props>> = {
  true_false: TrueFalseQuestion,
  choice: ChoiceQuestion,
  fill_in: FillInQuestion,
  short_answer: ShortAnswerQuestion,
  essay: EssayQuestion,
  code: CodeQuestion,
};

export function QuestionRenderer({ question, answer, onChange }: Props) {
  const Component = COMPONENTS[question.type];
  if (!Component) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        暂不支持此题型：{question.type}
      </p>
    );
  }
  return <Component key={question.question_id} question={question} answer={answer} onChange={onChange} />;
}
