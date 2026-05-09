import { useEffect, useState } from "react";
import { useCreate } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { ExamWizardForm } from "./components/ExamWizardForm";
import {
  getErrorMessage,
  toSubmitDateTime,
  type ExamFormValues,
} from "./components/exam-form-utils";

function createInitialForm(): ExamFormValues {
  return {
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
}

interface PublicLinkResponse {
  public_url: string;
}

interface PaperExamSeedItem {
  question_id: string;
  order: number;
  score_override: number | null;
}

interface PaperExamSeedResponse {
  paper_id: string;
  title: string;
  description: string | null;
  total_score: number;
  question_items: PaperExamSeedItem[];
}

export function ExamCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { mutate: create, mutation } = useCreate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<ExamFormValues>(() => createInitialForm());
  const [seedLoading, setSeedLoading] = useState(false);
  const { toast } = useToast();
  const seedPaperId = searchParams.get("paper_id");

  useEffect(() => {
    let cancelled = false;
    if (!seedPaperId) {
      setSeedLoading(false);
      setInitialValues(createInitialForm());
      setSubmitError(null);
      return () => {
        cancelled = true;
      };
    }
    setSeedLoading(true);
    setSubmitError(null);
    apiClient
      .get<PaperExamSeedResponse>(`/api/papers/${seedPaperId}/exam-seed`)
      .then((response) => {
        if (cancelled) return;
        const orderedItems = response.data.question_items
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((item, index) => ({
            question_id: item.question_id,
            order: index,
            score_override: item.score_override,
          }));
        setInitialValues({
          ...createInitialForm(),
          title: response.data.title,
          description: response.data.description ?? "",
          total_score:
            Number.isFinite(response.data.total_score) && response.data.total_score > 0
              ? Number(response.data.total_score.toFixed(2))
              : 100,
          question_mode: "manual",
          question_ids: orderedItems.map((item) => item.question_id),
          question_items: orderedItems,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setInitialValues(createInitialForm());
        toast({
          title: "试卷加载失败",
          description: getErrorMessage(error, "无法读取试卷题目，请返回试卷列表重试。"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) {
          setSeedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [seedPaperId, toast]);

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

  if (seedLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-6 py-20 text-muted-foreground">
        正在加载试卷题目...
      </div>
    );
  }

  return (
    <ExamWizardForm
      mode="create"
      initialValues={initialValues}
      isPending={mutation.isPending || seedLoading}
      submitError={submitError}
      onSubmit={handleSubmit}
    />
  );
}
