import { useCallback, useState } from "react";
import type { IExamTaking } from "@/types";
import { QuestionRenderer } from "./components/question-renderer";
import { ExamTopBar } from "./mobile/exam-top-bar";
import { ExamBottomBar } from "./mobile/exam-bottom-bar";
import { QuestionMapDrawer } from "./mobile/question-map-drawer";
import { SubmitConfirmSheet } from "./mobile/submit-confirm-sheet";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useSwipe } from "@/hooks/use-swipe";
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

interface ExamTakingMobileProps {
  examData: IExamTaking;
  answers: Record<string, Record<string, unknown>>;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  updateAnswer: (questionId: string, content: Record<string, unknown>) => void;
  flushQuestion: (questionId: string) => Promise<void>;
  isSubmittingAction: boolean;
  switchWarning: string | null;
  onBack: () => void;
  onTimeUp: () => void;
  onSubmitConfirm: () => void;
}

export function ExamTakingMobile({
  examData,
  answers,
  currentIndex,
  setCurrentIndex,
  saveState,
  updateAnswer,
  flushQuestion,
  isSubmittingAction,
  switchWarning,
  onBack,
  onTimeUp,
  onSubmitConfirm,
}: ExamTakingMobileProps) {
  const [mapOpen, setMapOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const { online } = useConnectivity();

  const questions = examData.questions;
  const currentQuestion = questions[currentIndex];

  const isAnswered = (ans: Record<string, unknown> | undefined) => {
    if (!ans) return false;
    return Object.values(ans).some((v) =>
      Array.isArray(v)
        ? v.length > 0 && v.some(Boolean)
        : v !== "" && v !== null && v !== undefined,
    );
  };

  const answeredCount = questions.filter((q) => isAnswered(answers[q.question_id])).length;

  const navigateToQuestion = useCallback(
    async (nextIndex: number) => {
      if (!questions[nextIndex] || !currentQuestion || isNavigating) return;
      setIsNavigating(true);
      try {
        await flushQuestion(currentQuestion.question_id);
        setCurrentIndex(nextIndex);
      } catch {
        // Save feedback surfaced by hook
      } finally {
        setIsNavigating(false);
      }
    },
    [currentQuestion, flushQuestion, isNavigating, questions, setCurrentIndex],
  );

  const swipe = useSwipe({
    onSwipeLeft: () => navigateToQuestion(currentIndex + 1),
    onSwipeRight: () => navigateToQuestion(currentIndex - 1),
  });

  return (
    <div
      data-testid="mobile-exam-shell"
      className="fixed inset-0 flex w-full max-w-full flex-col overflow-x-hidden overflow-y-hidden bg-background"
      style={{ touchAction: "pan-y" }}
    >
      {switchWarning && (
        <div className="absolute top-0 left-0 right-0 z-[60] bg-red-600 text-white text-center py-2 text-xs font-medium">
          {switchWarning}
        </div>
      )}

      <ExamTopBar
        title={examData.title}
        endTime={examData.end_time}
        startedAt={examData.started_at}
        durationMinutes={examData.duration_minutes}
        saveState={saveState}
        onBack={() => setLeaveConfirmOpen(true)}
        onTimeUp={onTimeUp}
      />

      <main
        data-testid="mobile-exam-content"
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: "contain" }}
        onTouchStart={swipe.onTouchStart}
        onTouchEnd={swipe.onTouchEnd}
      >
        {currentQuestion && (
          <div className="min-w-0 max-w-full px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                第 {currentIndex + 1} 题 / 共 {questions.length} 题
              </span>
            </div>
            <QuestionRenderer
              question={currentQuestion}
              answer={answers[currentQuestion.question_id] ?? {}}
              onChange={(content) => updateAnswer(currentQuestion.question_id, content)}
            />
          </div>
        )}
      </main>

      <ExamBottomBar
        currentIndex={currentIndex}
        totalQuestions={questions.length}
        onPrev={() => navigateToQuestion(currentIndex - 1)}
        onNext={() => navigateToQuestion(currentIndex + 1)}
        onOpenMap={() => setMapOpen(true)}
        onSubmit={() => setSubmitOpen(true)}
        isNavigating={isNavigating}
        isSubmitting={isSubmittingAction}
      />

      <QuestionMapDrawer
        open={mapOpen}
        onOpenChange={setMapOpen}
        questions={questions}
        answers={answers}
        currentIndex={currentIndex}
        onSelectQuestion={(index) => navigateToQuestion(index)}
      />

      <SubmitConfirmSheet
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answeredCount={answeredCount}
        totalCount={questions.length}
        online={online}
        isSubmitting={isSubmittingAction}
        onConfirm={() => {
          setSubmitOpen(false);
          onSubmitConfirm();
        }}
      />

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认离开考试？</AlertDialogTitle>
            <AlertDialogDescription>
              离开考试页面可能被记录为切屏，切屏次数达到上限将导致自动交卷。确定要返回吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续考试</AlertDialogCancel>
            <AlertDialogAction onClick={onBack}>确认离开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
