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
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "./utils";
import { getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "./i18n";

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

  return (
    <div className="space-y-6">
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
            onClick={() => navigate("/wrong-answers")}
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
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">{tStudent("wrong_detail_your_answer", undefined, locale)}</h2>
          {item.question_type === "code" && typeof item.student_answer.code === "string" && item.student_answer.code.trim() ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-[#e9e0f5] bg-[#1f1830]">
              <div className="border-b border-white/8 px-3 py-2 text-[12px] text-[#d6cfee]">
                {(item.student_answer.language as string | undefined) ?? "code"}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-[13px] leading-6 text-[#f5f1ff]">
                {item.student_answer.code as string}
              </pre>
            </div>
          ) : inferStudentAnswerLanguage(item.question_title, item.question_content, item.student_answer) === "sql" ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
              <CodeBlock code={renderAnswerAsCode(item.student_answer)} language="sql" />
            </div>
          ) : (
            <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
              <LatexText>{renderAnswerSummary(item.student_answer)}</LatexText>
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">{tStudent("wrong_detail_standard_answer", undefined, locale)}</h2>
          {inferStudentAnswerLanguage(item.question_title, item.question_content, item.student_answer) === "sql" ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
              <CodeBlock code={renderAnswerAsCode(item.standard_answer)} language="sql" />
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
          <div className="mt-5 rounded-xl bg-[#f8f5fc] p-4 text-[14px] leading-6 text-muted-foreground">
            {tStudent("result_analysis", { text: item.analysis }, locale)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
