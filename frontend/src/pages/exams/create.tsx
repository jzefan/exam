import { useState } from "react";
import { useCreate } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { ExamWizardForm } from "./components/ExamWizardForm";
import {
  getErrorMessage,
  type ExamFormValues,
} from "./components/exam-form-utils";

const initialForm: ExamFormValues = {
  title: "",
  description: "",
  start_time: "",
  end_time: "",
  duration_minutes: 60,
  total_score: 100,
  status: "draft",
  position_id: null,
  max_switch_count: 0,
  show_result: false,
  notes_template: "",
  question_ids: [],
  question_items: [],
  student_ids: [],
};

export function ExamCreate() {
  const navigate = useNavigate();
  const { mutate: create, mutation } = useCreate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = (values: ExamFormValues) => {
    setSubmitError(null);
    create(
      {
        resource: "exams",
        values: {
          ...values,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          notes_template: values.notes_template || null,
          position_id: values.position_id || null,
          question_items: values.question_items,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "创建成功",
            description: "考试已创建，正在返回考试列表。",
          });
          navigate("/exams");
        },
        onError: (error) => {
          const message = getErrorMessage(error, "创建考试失败，请稍后重试。");
          setSubmitError(message);
          toast({
            title: "创建失败",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <ExamWizardForm
      mode="create"
      initialValues={initialForm}
      isPending={mutation.isPending}
      submitError={submitError}
      onSubmit={handleSubmit}
    />
  );
}
