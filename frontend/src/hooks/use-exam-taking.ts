import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import type { IExamTaking } from "@/types";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface UseExamTakingOptions {
  examData: IExamTaking | null;
}

export function useExamTaking({ examData }: UseExamTakingOptions) {
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const dirtyRef = useRef(new Set<string>());
  const answersRef = useRef(answers);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (examData?.saved_answers) {
      setAnswers(examData.saved_answers);
    }
  }, [examData?.saved_answers]);

  const updateAnswer = useCallback(
    (questionId: string, content: Record<string, unknown>) => {
      setAnswers((prev) => ({ ...prev, [questionId]: content }));
      dirtyRef.current.add(questionId);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flushAnswers();
      }, 30_000);
    },
    [],
  );

  const flushAnswers = useCallback(() => {
    if (!examData || dirtyRef.current.size === 0) return;
    const currentAnswers = answersRef.current;
    const batch = Array.from(dirtyRef.current).map((qid) => ({
      question_id: qid,
      answer_content: currentAnswers[qid] ?? {},
    }));
    dirtyRef.current.clear();
    api.post(`/api/student/exams/${examData.exam_id}/answers`, {
      answers: batch,
    });
  }, [examData]);

  const submitExam = useCallback(async () => {
    if (!examData) return;
    flushAnswers();
    await api.post(`/api/student/exams/${examData.exam_id}/submit`);
  }, [examData, flushAnswers]);

  const reportSwitch = useCallback(
    (count: number) => {
      if (!examData) return;
      api.post(`/api/student/exams/${examData.exam_id}/switch`, {
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
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    updateAnswer,
    flushAnswers,
    submitExam,
    reportSwitch,
  };
}
