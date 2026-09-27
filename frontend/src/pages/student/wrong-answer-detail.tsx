import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { LatexText, renderLatexInHtml } from "@/components/ui/latex-text";
import { CodeBlock } from "@/components/ui/code-block";
import { useOne, useInvalidate } from "@refinedev/core";
import { ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IWrongAnswerDetail } from "@/types";
import {
  formatStudentDate,
  getStudentAnswerCodeLanguage,
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "./utils";
import { getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "./i18n";
import { SelectionAIExplain } from "./components/selection-ai-explain";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function WrongAnswerDetailPage() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const { id } = useParams<{ id: string }>();
  const [mastered, setMastered] = useState(false);
  const invalidate = useInvalidate();

  const { query } = useOne<IWrongAnswerDetail>({
    resource: "wrong-answers",
    id: id ?? "",
  });

  const item = query.data?.data;
  const effectiveMastered = mastered || item?.mastered;

  // 从试卷/练习的错题列表进来时原路返回，直接打开链接则回到错题回顾首页。
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  const handleBack = () => {
    if (historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate("/wrong-answers");
  };

  const handleMarkMastered = async () => {
    if (!id) return;
    await api.post(`/api/wrong-answers/${id}/mastered`);
    setMastered(true);
    invalidate({
      resource: "wrong-answers",
      invalidates: ["list"],
    });
  };

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!item) {
    return (
      <div className="rounded-2xl border bg-white/90 p-8 text-[14px] text-muted-foreground">
        {tStudent("wrong_detail_not_found", undefined, locale)}
      </div>
    );
  }

  const studentCodeLanguage = getStudentAnswerCodeLanguage(
    item.question_type,
    item.question_title,
    item.question_content,
    item.student_answer,
  );
  const standardCodeLanguage = getStudentAnswerCodeLanguage(
    item.question_type,
    item.question_title,
    item.question_content,
    item.standard_answer,
  );
  const studentCode = renderAnswerAsCode(item.student_answer);
  const standardCode = renderAnswerAsCode(item.standard_answer);
  const isSqlAnswer =
    inferStudentAnswerLanguage(item.question_title, item.question_content, item.student_answer) === "sql";
  const shouldRenderStudentCode =
    (item.question_type === "code" || Boolean(studentCodeLanguage)) &&
    Boolean(studentCode.trim());
  const shouldRenderStandardCode =
    (item.question_type === "code" || Boolean(standardCodeLanguage)) &&
    Boolean(standardCode.trim());
  const choiceOptions =
    item.question_type === "choice" &&
    item.question_options &&
    typeof item.question_options === "object"
      ? Object.entries(item.question_options)
      : [];

  return (
    <div className="space-y-6" data-ai-explain-question-id={item.question_id}>
      <SelectionAIExplain wrongAnswerId={item.id} enabled />
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-foreground tracking-tight">{tStudent("wrong_detail_title", undefined, locale)}</h1>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleMarkMastered}
            disabled={Boolean(effectiveMastered)}
            className="text-[14px]"
          >
            {effectiveMastered
              ? tStudent("wrong_detail_mastered", undefined, locale)
              : tStudent("wrong_detail_mark_mastered", undefined, locale)}
          </Button>
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            {tStudent("wrong_detail_back", undefined, locale)}
          </button>
        </div>
      </div>

      <section className="space-y-4 rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#f5f1fb] px-2.5 py-1 text-[12px] text-[#6647d5]">
            {getStudentQuestionTypeLabel(item.question_type, locale)}
          </span>
          <span className="text-[12px] text-muted-foreground">{item.exam_title}</span>
          {item.exam_question_order != null ? (
            <span className="text-[12px] text-muted-foreground">
              {tStudent("result_question_number", { number: item.exam_question_order + 1 }, locale)}
            </span>
          ) : null}
          <span className="text-[12px] text-muted-foreground">{tStudent("wrong_detail_recent_wrong", { time: formatStudentDate(item.last_wrong_at) }, locale)}</span>
        </div>
        <h1
          className="text-[16px] font-semibold leading-7 text-foreground"
          dangerouslySetInnerHTML={{ __html: renderLatexInHtml(item.question_title) }}
        />
        <div
          className="prose prose-sm max-w-none text-[14px] leading-6"
          dangerouslySetInnerHTML={{
            __html: renderLatexInHtml((item.question_content.text as string | undefined) ?? item.question_title),
          }}
        />
        {choiceOptions.length > 0 ? (
          <div className="grid gap-2">
            {choiceOptions.map(([key, value]) => (
              <div
                key={key}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold text-muted-foreground">
                  {key}
                </span>
                <span className="pt-1 text-[14px] leading-6 text-foreground">
                  <LatexText>{String(value)}</LatexText>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">{tStudent("wrong_detail_your_answer", undefined, locale)}</h2>
          {shouldRenderStudentCode ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] capitalize text-muted-foreground">
                {studentCodeLanguage ?? "code"}
              </div>
              <CodeBlock code={studentCode} language={studentCodeLanguage} />
            </div>
          ) : isSqlAnswer ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
              <CodeBlock code={studentCode} language="sql" />
            </div>
          ) : (
            <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
              <LatexText>{renderAnswerSummary(item.student_answer)}</LatexText>
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">{tStudent("wrong_detail_standard_answer", undefined, locale)}</h2>
          {shouldRenderStandardCode ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] capitalize text-muted-foreground">
                {standardCodeLanguage ?? studentCodeLanguage ?? "code"}
              </div>
              <CodeBlock code={standardCode} language={standardCodeLanguage ?? studentCodeLanguage} />
            </div>
          ) : isSqlAnswer ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
              <CodeBlock code={standardCode} language="sql" />
            </div>
          ) : (
            <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
              <LatexText>{renderStandardAnswer(item.standard_answer)}</LatexText>
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
        <h2 className="text-[16px] font-semibold">{tStudent("wrong_detail_feedback", undefined, locale)}</h2>
        <div className="mt-4 space-y-3">
          {item.feedback.strengths?.map((line: string) => (
            <div key={line} className="flex items-start gap-2 text-[14px] text-emerald-700">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
          {item.feedback.deductions?.map((line: string) => (
            <div key={line} className="flex items-start gap-2 text-[14px] text-amber-700">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
        </div>
        {item.analysis ? (
          <div className="mt-5 rounded-xl bg-[#f8f5fc] p-4">
            <p className="text-[14px] font-medium text-foreground">
              {tStudent("result_analysis_section", undefined, locale)}
            </p>
            <div
              className="mt-2 text-[14px] leading-6 text-muted-foreground [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border/60 [&_img]:object-contain [&_p]:m-0 [&_p+*]:mt-3"
              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(item.analysis) }}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
