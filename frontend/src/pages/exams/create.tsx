import { useEffect, useRef, useState } from "react";
import { useCreate } from "@refinedev/core";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { consumeExamSeed } from "@/lib/exam-seed";
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
    duration_minutes: 90,
    total_score: 0,
    status: "draft",
    position_id: null,
    max_switch_count: 0,
    allow_retake: false,
    show_result: true,
    show_score: true,
    notes_template: "",
    question_mode: "auto",
    question_ids: [],
    question_items: [],
    student_ids: [],
    public_link_enabled: false,
  };
}

function getNextCourseExamTitle(courseName: string | undefined, existingTitles: string[] = []) {
  const baseTitle = `${courseName?.trim() || "课程"}-考试`;
  let maxSuffix = existingTitles.includes(baseTitle) ? 0 : -1;
  const escapedBase = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedBase}-(\\d+)$`);

  for (const title of existingTitles) {
    const match = title.match(pattern);
    if (match) {
      maxSuffix = Math.max(maxSuffix, Number(match[1]));
    }
  }

  return maxSuffix < 0 ? baseTitle : `${baseTitle}-${maxSuffix + 1}`;
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
  const location = useLocation();
  const navState = (location.state ?? {}) as {
    successTo?: string;
    courseKpId?: string;
    courseSemesterId?: string;
    courseName?: string;
    existingExamTitles?: string[];
    defaultBankName?: string;
  };
  const [searchParams] = useSearchParams();
  const { mutate: create, mutation } = useCreate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<ExamFormValues>(() => ({
    ...createInitialForm(),
    title: navState.courseName
      ? getNextCourseExamTitle(navState.courseName, navState.existingExamTitles)
      : "",
  }));
  const [seedLoading, setSeedLoading] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState(0);
  const [wizardDefaultBankName, setWizardDefaultBankName] = useState<string | undefined>(
    navState.defaultBankName,
  );
  const { toast } = useToast();
  const seedPaperId = searchParams.get("paper_id");
  const seedKey = searchParams.get("seed_key");

  const seedConsumedRef = useRef(false);

  // 从题目列表跳转过来的 seed_key 分支：一次性从 sessionStorage 取出预填数据。
  // 注意：seed_key 必须优先于 paper_id 处理，因为前者是更明确的用户意图。
  useEffect(() => {
    if (!seedKey) return;
    // Strict Mode 下 effect 会执行两次，用 ref 防止第一次就 consume 掉 seed。
    if (seedConsumedRef.current) return;
    seedConsumedRef.current = true;
    const payload = consumeExamSeed(seedKey);
    if (!payload) {
      toast({
        title: "预填数据已过期",
        description: "请回到题目列表重新选择后再进入。",
        variant: "destructive",
      });
      return;
    }
    // 预填虽然带了 category，但如果对话框跳错了路由，这里以 URL 路由为准。
    // ExamCreate 对应 category=exam，强制覆盖。
    setInitialValues({
      ...createInitialForm(),
      category: "exam",
      title: navState.courseName
        ? getNextCourseExamTitle(navState.courseName, navState.existingExamTitles)
        : (payload.title ?? ""),
      description: payload.description ?? "",
      question_mode: "auto",
      question_ids: payload.question_items.map((item) => item.question_id),
      question_items: payload.question_items.map((item, index) => ({
        question_id: item.question_id,
        order: index,
        score_override: item.score_override,
      })),
      student_ids: payload.student_ids ?? [],
    });
    setSubmitError(null);

    // 从课程详情跳转过来：自动跳到选题步骤，并默认选中课程题库。
    setWizardInitialStep(1);
    const courseNameMatch = (payload.description ?? "").match(/「(.+?)」/);
    if (courseNameMatch?.[1]) {
      setWizardDefaultBankName(`${courseNameMatch[1]}-题库`);
    } else if (navState.defaultBankName) {
      setWizardDefaultBankName(navState.defaultBankName);
    }
  }, [navState.courseName, navState.defaultBankName, navState.existingExamTitles, seedKey, toast]);

  useEffect(() => {
    let cancelled = false;
    if (seedKey) {
      // seed_key 路径独立处理，不走 paper 预填。
      setSeedLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (!seedPaperId) {
      setSeedLoading(false);
      setInitialValues({
        ...createInitialForm(),
        title: navState.courseName
          ? getNextCourseExamTitle(navState.courseName, navState.existingExamTitles)
          : "",
      });
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
  }, [navState.courseName, navState.existingExamTitles, seedKey, seedPaperId, toast]);

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
          ...(navState.courseKpId ? { course_kp_id: navState.courseKpId } : {}),
          ...(navState.courseSemesterId
            ? { course_semester_id: navState.courseSemesterId }
            : {}),
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
          navigate(navState.successTo ?? "/exams");
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
      initialStep={wizardInitialStep}
      defaultAutoBankName={wizardDefaultBankName}
      defaultBankName={wizardDefaultBankName}
    />
  );
}
