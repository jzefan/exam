import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Brain, CircleAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { IAppealResponse, IExamResult } from "@/types";
import { formatStudentDate, questionTypeLabel, renderAnswerSummary, renderStandardAnswer } from "./utils";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function ExamResultPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [appealQuestionId, setAppealQuestionId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeQuestion = result?.questions.find((item) => item.question_id === appealQuestionId);

  const loadResult = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await api.get<IExamResult>(`/api/student/exams/${id}/result`);
      setResult(response.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadResult();
  }, [id]);

  const submitAppeal = async () => {
    if (!id || !appealQuestionId || !appealReason.trim()) return;
    setSubmitting(true);
    try {
      await api.post<IAppealResponse>(`/api/student/exams/${id}/appeals`, {
        question_id: appealQuestionId,
        reason: appealReason.trim(),
      });
      setAppealReason("");
      setAppealQuestionId(null);
      await loadResult();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="h-72 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!result) {
    return <div className="rounded-2xl border bg-white/90 p-8 text-[14px] text-muted-foreground">未能加载考试结果。</div>;
  }

  if (!result.can_view) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-foreground tracking-tight">{result.title}</h1>
          <button
            onClick={() => navigate("/my-exams")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            返回我的考试
          </button>
        </div>
        <div className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-8">
          <p className="text-[14px] text-muted-foreground">{result.blocked_reason ?? "暂无权限查看结果"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-foreground tracking-tight">考试结果</h1>
        <div className="flex items-center gap-3">
          <span className="text-[14px] text-muted-foreground">
            提交时间：{formatStudentDate(result.submitted_at)}
          </span>
          <button
            onClick={() => navigate("/my-exams")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            返回我的考试
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-foreground">{result.title}</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">查看标准答案、评分反馈和改进建议。</p>
          </div>
          <div className="rounded-2xl bg-[#f5f1fb] px-5 py-4 text-right">
            <p className="text-[12px] text-[#7e7190]">总分</p>
            <p className="mt-1 text-[16px] font-semibold text-[#6647d5]">
              {result.score ?? 0} / {result.total_score}
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        {result.questions.map((question) => (
          <section key={question.question_id} className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#f5f1fb] px-2.5 py-1 text-[12px] text-[#6647d5]">
                    {questionTypeLabel[question.type]}
                  </span>
                  <span className="text-[12px] text-muted-foreground">第 {question.order + 1} 题</span>
                </div>
                <h2 className="text-[16px] font-semibold leading-7 text-foreground">{question.title}</h2>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-muted-foreground">得分</p>
                <p className="text-[16px] font-semibold text-[#6647d5]">
                  {question.score_awarded} / {question.total_score}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl bg-[#faf8fc] p-4">
                <p className="text-[14px] font-medium text-foreground">你的答案</p>
                {question.type === "code" && typeof question.answer_content.code === "string" && question.answer_content.code.trim() ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-[#e9e0f5] bg-[#1f1830]">
                    <div className="border-b border-white/8 px-3 py-2 text-[12px] text-[#d6cfee]">
                      {(question.answer_content.language as string | undefined) ?? "code"}
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-[13px] leading-6 text-[#f5f1ff]">
                      {question.answer_content.code as string}
                    </pre>
                  </div>
                ) : (
                  <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                    {renderAnswerSummary(question.answer_content)}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-[#faf8fc] p-4">
                <p className="text-[14px] font-medium text-foreground">标准答案</p>
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  {renderStandardAnswer(question.standard_answer)}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-[#ede6f5] bg-[#fcfbfe] p-4">
              <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                <Brain size={16} className="text-[#6647d5]" />
                评分详情
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {question.feedback.dimensions?.map((dimension) => (
                  <div key={dimension.name} className="rounded-xl bg-white p-4">
                    <div className="flex items-center justify-between text-[14px] font-medium">
                      <span>{dimension.name}</span>
                      <span className="text-[#6647d5]">
                        {dimension.score} / {dimension.max_score}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{dimension.comment}</p>
                  </div>
                ))}
              </div>
              {question.feedback.deductions?.length ? (
                <div className="mt-4 space-y-2">
                  {question.feedback.deductions.map((line) => (
                    <div key={line} className="flex items-start gap-2 text-[14px] text-amber-700">
                      <CircleAlert size={16} className="mt-0.5 shrink-0" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {question.feedback.suggestions?.length ? (
                <div className="mt-4 rounded-xl bg-white p-4 text-[14px] leading-6 text-muted-foreground">
                  改进建议：{question.feedback.suggestions.join("；")}
                </div>
              ) : null}
            </div>

            {question.analysis ? (
              <div className="mt-5 rounded-xl bg-[#f7f2fb] p-4 text-[14px] leading-6 text-muted-foreground">
                题目解析：{question.analysis}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[14px] text-muted-foreground">
                申诉状态：
                <span className="ml-1 font-medium text-foreground">
                  {question.appeal_status === "pending"
                    ? "待处理"
                    : question.appeal_status === "resolved"
                      ? "已处理"
                      : question.appeal_status === "rejected"
                        ? "已驳回"
                        : "未申诉"}
                </span>
              </div>
              <Button
                variant="outline"
                className="text-[14px]"
                disabled={Boolean(question.appeal_status)}
                onClick={() => setAppealQuestionId(question.question_id)}
              >
                <Send size={14} />
                发起申诉
              </Button>
            </div>

            {question.appeal_reason ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#e8def5] p-4 text-[14px] leading-6 text-muted-foreground">
                申诉理由：{question.appeal_reason}
                {question.appeal_reply ? <div className="mt-2">教师回复：{question.appeal_reply}</div> : null}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <AlertDialog open={Boolean(appealQuestionId)} onOpenChange={(open) => !open && setAppealQuestionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发起成绩申诉</AlertDialogTitle>
            <AlertDialogDescription>
              请填写你对这道题评分结果的说明，提交后会流转到教师端处理。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-[14px] text-muted-foreground">
              {activeQuestion?.title}
            </div>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="请说明你认为评分不准确的原因，例如答案已覆盖关键点、表述被误判等。"
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3 py-3 text-[14px] outline-none focus:border-[#8a6fe2]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={submitting || appealReason.trim().length < 3} onClick={submitAppeal}>
              提交申诉
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
