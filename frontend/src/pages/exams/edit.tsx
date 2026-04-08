import { useState } from "react";
import { useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { ExamWizardForm } from "./components/ExamWizardForm";
import { examStatusOptions } from "./components/ExamStatusBadge";
import type { IExamQuestion, IExamStudent } from "@/types";
import {
  getErrorMessage,
  type ExamFormValues,
} from "./components/exam-form-utils";

type ExamDetail = ExamFormValues & {
  questions: IExamQuestion[];
  students: IExamStudent[];
};

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toExamForm(exam: ExamDetail): ExamFormValues {
  return {
    title: exam.title,
    description: exam.description || "",
    start_time: toLocalDatetime(exam.start_time),
    end_time: toLocalDatetime(exam.end_time),
    duration_minutes: exam.duration_minutes,
    total_score: exam.total_score,
    status: exam.status,
    position_id: exam.position_id || null,
    max_switch_count: exam.max_switch_count ?? 0,
    show_result: exam.show_result ?? false,
    notes_template: exam.notes_template || "",
    question_ids: exam.questions.map((q) => q.question_id),
    student_ids: exam.students.map((s) => s.student_id),
  };
}

function ExamEditForm({ id, exam }: { id: string; exam: ExamDetail }) {
  const navigate = useNavigate();
  const { mutate: update, mutation } = useUpdate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const initialValues = toExamForm(exam);
  const isLocked =
    initialValues.status === "ongoing" ||
    initialValues.status === "completed" ||
    initialValues.status === "closed";

  const handleSubmit = (values: ExamFormValues) => {
    setSubmitError(null);
    update(
      {
        resource: "exams",
        id,
        values: {
          ...values,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          notes_template: values.notes_template || null,
          position_id: values.position_id || null,
        },
      },
      {
        onSuccess: () => navigate("/exams"),
        onError: (error) => setSubmitError(getErrorMessage(error, "保存考试失败，请稍后重试。")),
      },
    );
  };

  return (
    <ExamWizardForm
      mode="edit"
      initialValues={initialValues}
      isPending={mutation.isPending}
      submitError={submitError}
      onSubmit={handleSubmit}
      banner={
        isLocked ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
            考试当前状态为「{examStatusOptions.find((o) => o.value === initialValues.status)?.label}」，部分设置可能无法修改
          </div>
        ) : null
      }
    />
  );
}

export function ExamEdit() {
  const { id } = useParams<{ id: string }>();

  const { result: exam, query } = useOne<ExamDetail>({
    resource: "exams",
    id: id!,
  });

  if (query.isLoading || !exam) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return <ExamEditForm id={id!} exam={exam} />;
}
