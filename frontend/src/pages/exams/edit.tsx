import { useState } from "react";
import { useOne, useUpdate } from "@refinedev/core";
import { useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { ExamWizardForm } from "./components/ExamWizardForm";
import { examStatusOptions } from "./components/ExamStatusBadge";
import type { IExamQuestion, IExamStudent } from "@/types";
import {
  getErrorMessage,
  toSubmitDateTime,
  type ExamFormValues,
} from "./components/exam-form-utils";

type ExamDetail = ExamFormValues & {
  questions: IExamQuestion[];
  students: IExamStudent[];
};

interface PublicLinkResponse {
  public_url: string;
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toExamForm(exam: ExamDetail): ExamFormValues {
  return {
    category: exam.category ?? "exam",
    title: exam.title,
    description: exam.description || "",
    start_time: toLocalDatetime(exam.start_time),
    end_time: toLocalDatetime(exam.end_time),
    duration_minutes: exam.duration_minutes,
    total_score: exam.total_score,
    status: exam.status,
    position_id: exam.position_id || null,
    max_switch_count: exam.max_switch_count ?? 0,
    allow_retake: exam.allow_retake ?? false,
    show_result: exam.show_result ?? false,
    notes_template: exam.notes_template || "",
    question_mode: exam.question_mode ?? null,
    question_ids: exam.questions.map((q) => q.question_id),
    question_items: exam.questions.map((q, index) => ({
      question_id: q.question_id,
      order: q.order ?? index,
      score_override: q.score_override ?? q.question_score ?? null,
    })),
    student_ids: exam.students.map((s) => s.student_id),
    public_link_enabled: false,
  };
}

function ExamEditForm({ id, exam }: { id: string; exam: ExamDetail }) {
  const { mutate: update, mutation } = useUpdate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [currentExam, setCurrentExam] = useState(exam);
  const { toast } = useToast();

  const initialValues = toExamForm(currentExam);
  const isLocked =
    initialValues.status === "ongoing" ||
    initialValues.status === "completed" ||
    initialValues.status === "closed";

  const handleSubmit = (values: ExamFormValues) => {
    setSubmitError(null);
    const { public_link_enabled: publicLinkEnabled, ...submitValues } = values;
    update(
      {
        resource: "exams",
        id,
        values: {
          ...submitValues,
          start_time: toSubmitDateTime(submitValues.start_time),
          end_time: toSubmitDateTime(submitValues.end_time),
          notes_template: submitValues.notes_template || null,
          position_id: submitValues.position_id || null,
          category: submitValues.category,
          question_mode: submitValues.question_mode,
          question_items: submitValues.question_items,
        },
      },
      {
        onSuccess: async (response) => {
          if (publicLinkEnabled) {
            try {
              const link = await apiClient.post<PublicLinkResponse>(`/api/exams/${id}/public-link`);
              await navigator.clipboard?.writeText(link.data.public_url).catch(() => undefined);
              toast({
                title: "公开链接已生成",
                description: "公开链接已复制，外部考生填写姓名和手机号后即可进入。",
              });
            } catch (error) {
              toast({
                title: "公开链接生成失败",
                description: getErrorMessage(error, "考试修改已保存，但公开链接生成失败。"),
                variant: "destructive",
              });
            }
          }
          setSubmitError(null);
          setCurrentExam(response.data as ExamDetail);
          toast({
            title: "保存成功",
            description: "考试修改已保存。",
          });
        },
        onError: (error) => {
          const message = getErrorMessage(error, "保存考试失败，请稍后重试。");
          setSubmitError(message);
          toast({
            title: "保存失败",
            description: message,
            variant: "destructive",
          });
        },
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
