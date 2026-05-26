import { useCallback, useRef } from "react";
import { clearDraft, getDraft, setDraft } from "@/lib/exam-draft";

export interface ExamDraftHook {
  save: (answers: Record<string, unknown>) => void;
  load: () => Record<string, unknown> | null;
  clear: () => void;
}

export function useExamDraft(principalId: string, attemptId: string): ExamDraftHook {
  const principalRef = useRef(principalId);
  const attemptRef = useRef(attemptId);
  principalRef.current = principalId;
  attemptRef.current = attemptId;

  const save = useCallback((answers: Record<string, unknown>) => {
    setDraft(principalRef.current, attemptRef.current, answers);
  }, []);

  const load = useCallback((): Record<string, unknown> | null => {
    const draft = getDraft(principalRef.current, attemptRef.current);
    return draft?.answers ?? null;
  }, []);

  const clear = useCallback(() => {
    clearDraft(principalRef.current, attemptRef.current);
  }, []);

  return { save, load, clear };
}
