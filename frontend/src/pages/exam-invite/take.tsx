import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ExamTaking } from "@/pages/student/exam-taking";
import { getGuestExamId, getGuestToken } from "./guest-session";

export function GuestExamTakePage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!examId || !getGuestToken() || getGuestExamId() !== examId) {
      navigate("/exam-invite", { replace: true });
    }
  }, [examId, navigate]);

  if (!examId) return null;
  return <ExamTaking examIdOverride={examId} onSubmitted={() => navigate("/exam-invite/done")} />;
}
