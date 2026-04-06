import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useOne } from "@refinedev/core";
import { ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IWrongAnswerDetail } from "@/types";
import { formatStudentDate, questionTypeLabel, renderAnswerSummary, renderStandardAnswer } from "./utils";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function WrongAnswerDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [mastered, setMastered] = useState(false);

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
  };

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!item) {
    return (
      <div className="rounded-2xl border bg-white/90 p-8 text-[14px] text-muted-foreground">
        未找到错题详情。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/wrong-answers")}
          className="inline-flex items-center gap-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} />
          返回错题本
        </button>

        <Button
          onClick={handleMarkMastered}
          disabled={Boolean(effectiveMastered)}
          className="text-[14px]"
        >
          {effectiveMastered ? "已标记掌握" : "标记已掌握"}
        </Button>
      </div>

      <section className="space-y-4 rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#f5f1fb] px-2.5 py-1 text-[12px] text-[#6647d5]">
            {questionTypeLabel[item.question_type]}
          </span>
          <span className="text-[12px] text-muted-foreground">{item.exam_title}</span>
          <span className="text-[12px] text-muted-foreground">最近错误：{formatStudentDate(item.last_wrong_at)}</span>
        </div>
        <h1
          className="text-[16px] font-semibold leading-7 text-foreground"
          dangerouslySetInnerHTML={{ __html: item.question_title }}
        />
        <div
          className="prose prose-sm max-w-none text-[14px] leading-6"
          dangerouslySetInnerHTML={{
            __html: (item.question_content.text as string | undefined) ?? item.question_title,
          }}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">你的答案</h2>
          {item.question_type === "code" && typeof item.student_answer.code === "string" && item.student_answer.code.trim() ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-[#e9e0f5] bg-[#1f1830]">
              <div className="border-b border-white/8 px-3 py-2 text-[12px] text-[#d6cfee]">
                {(item.student_answer.language as string | undefined) ?? "code"}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-[13px] leading-6 text-[#f5f1ff]">
                {item.student_answer.code as string}
              </pre>
            </div>
          ) : (
            <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
              {renderAnswerSummary(item.student_answer)}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
          <h2 className="text-[16px] font-semibold">正确答案</h2>
          <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
            {renderStandardAnswer(item.standard_answer)}
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
        <h2 className="text-[16px] font-semibold">评分反馈</h2>
        <div className="mt-4 space-y-3">
          {item.feedback.strengths?.map((line) => (
            <div key={line} className="flex items-start gap-2 text-[14px] text-emerald-700">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
          {item.feedback.deductions?.map((line) => (
            <div key={line} className="flex items-start gap-2 text-[14px] text-amber-700">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
        </div>
        {item.analysis ? (
          <div className="mt-5 rounded-xl bg-[#f8f5fc] p-4 text-[14px] leading-6 text-muted-foreground">
            题目解析：{item.analysis}
          </div>
        ) : null}
      </section>
    </div>
  );
}
