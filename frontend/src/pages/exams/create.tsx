import { useState } from "react";
import { useCreate } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { ExamWizardForm } from "./components/ExamWizardForm";
import {
  getErrorMessage,
  toSubmitDateTime,
  type ExamFormValues,
} from "./components/exam-form-utils";

const initialForm: ExamFormValues = {
  category: "exam",
  title: "",
  description: "",
  start_time: "",
  end_time: "",
  duration_minutes: 60,
  total_score: 100,
  status: "draft",
  position_id: null,
  max_switch_count: 0,
  allow_retake: false,
  show_result: false,
  notes_template: "",
  question_mode: "manual",
  question_ids: [],
  question_items: [],
  student_ids: [],
  public_link_enabled: false,
};

interface PublicLinkResponse {
  public_url: string;
}

export function ExamCreate() {
  const navigate = useNavigate();
  const { mutate: create, mutation } = useCreate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = (values: ExamFormValues) => {
    setSubmitError(null);
    const isDraft = values.status === "draft";
    const { public_link_enabled: publicLinkEnabled, ...submitValues } = values;
    create(
      {
        resource: "exams",
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
          if (!isDraft && publicLinkEnabled && response.data?.id) {
            try {
              const link = await apiClient.post<PublicLinkResponse>(`/api/exams/${response.data.id}/public-link`);
              await navigator.clipboard?.writeText(link.data.public_url).catch(() => undefined);
              toast({
                title: "公开链接已生成",
                description: "公开链接已复制，外部考生填写姓名和手机号后即可进入。",
              });
            } catch (error) {
              toast({
                title: "公开链接生成失败",
                description: getErrorMessage(error, "考试已创建，但公开链接生成失败。"),
                variant: "destructive",
              });
            }
          }
          toast({
            title: isDraft ? "草稿已保存" : "创建成功",
            description: isDraft ? "考试已保存到草稿。" : "考试已创建并发布，正在返回考试列表。",
          });
          navigate("/exams");
        },
        onError: (error) => {
          const message = getErrorMessage(error, isDraft ? "保存草稿失败，请稍后重试。" : "创建考试失败，请稍后重试。");
          setSubmitError(message);
          toast({
            title: isDraft ? "保存草稿失败" : "创建失败",
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
