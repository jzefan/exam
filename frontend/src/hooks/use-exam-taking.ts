import { useState, useCallback, useRef, useEffect } from "react";
import type { IExamTaking, ISubmitExamResponse } from "@/types";
import { apiClient } from "@/lib/api";

interface UseExamTakingOptions {
  examData: IExamTaking | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function hasAnswerContent(answer: Record<string, unknown> | undefined): boolean {
  if (!answer) return false;
  return Object.values(answer).some((value) =>
    Array.isArray(value)
      ? value.length > 0 && value.some(Boolean)
      : value !== "" && value !== null && value !== undefined,
  );
}

function buildAnswerBatch(
  questionIds: string[],
  currentAnswers: Record<string, Record<string, unknown>>,
) {
  return questionIds
    .map((qid) => ({
      question_id: qid,
      answer_content: currentAnswers[qid] ?? {},
    }))
    .filter((item) => hasAnswerContent(item.answer_content));
}

export function useExamTaking({ examData }: UseExamTakingOptions) {
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const dirtyRef = useRef(new Set<string>());
  const answersRef = useRef(answers);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (examData?.saved_answers) {
      setAnswers(examData.saved_answers);
      answersRef.current = examData.saved_answers;
    }
  }, [examData?.saved_answers]);

  const flushQuestions = useCallback(
    async (questionIds?: string[]) => {
      if (!examData) return;

      const ids = questionIds ?? Array.from(dirtyRef.current);
      if (ids.length === 0) return;

      const currentAnswers = answersRef.current;
      const batch = buildAnswerBatch(ids, currentAnswers);

      ids.forEach((qid) => dirtyRef.current.delete(qid));
      if (dirtyRef.current.size === 0 && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (batch.length === 0) return;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      setSaveState("saving");
      setSaveMessage("正在保存...");
      try {
        await apiClient.post(`/api/student/exams/${examData.exam_id}/answers`, {
          answers: batch,
        });
        setSaveState("saved");
        setSaveMessage("已自动保存");
        feedbackTimerRef.current = setTimeout(() => {
          setSaveState("idle");
          setSaveMessage("");
        }, 1800);
      } catch (error) {
        setSaveState("error");
        setSaveMessage("保存失败，稍后重试");
        throw error;
      }
    },
    [examData],
  );

  const updateAnswer = useCallback(
    (questionId: string, content: Record<string, unknown>) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: content };
        answersRef.current = next;
        return next;
      });
      dirtyRef.current.add(questionId);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flushQuestions();
      }, 30_000);
    },
    [flushQuestions],
  );

  const flushAnswers = useCallback(() => {
    return flushQuestions();
  }, [flushQuestions]);

  const flushQuestion = useCallback(
    (questionId: string) => flushQuestions([questionId]),
    [flushQuestions],
  );

  const submitExam = useCallback(async () => {
    if (!examData) return;
    const finalAnswerIds = Object.keys(answersRef.current);
    const finalAnswers = buildAnswerBatch(finalAnswerIds, answersRef.current);
    dirtyRef.current.clear();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const response = await apiClient.post<ISubmitExamResponse>(`/api/student/exams/${examData.exam_id}/submit`, {
      answers: finalAnswers,
    });
    return response.data;
  }, [examData]);

  const reportSwitch = useCallback(
    (count: number) => {
      if (!examData) return;
      apiClient.post(`/api/student/exams/${examData.exam_id}/switch`, {
        switch_count: count,
      });
    },
    [examData],
  );

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    saveState,
    saveMessage,
    updateAnswer,
    flushAnswers,
    flushQuestion,
    submitExam,
    reportSwitch,
  };
}
