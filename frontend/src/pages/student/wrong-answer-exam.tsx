import { useState } from "react";
import { useList } from "@refinedev/core";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, ChevronRight, ClipboardList, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStudentDateLocale, getStudentLocale, tStudent } from "./i18n";
import { WrongAnswerCard } from "./components/wrong-answer-card";
import { RemedialPracticeDialog } from "./components/remedial-practice-dialog";
import { useRemedialPracticeAnalysis } from "./use-remedial-practice";
import {
  buildRemedialPracticeHref,
  buildWrongAnswerListHref,
  getRemedialPracticeStatus,
  getWrongAnswerSourceKey,
  getWrongAnswerCategoryLabel,
  readWrongAnswerTab,
  WRONG_ANSWER_LEGACY_EXAM_KEY,
  type IRemedialPracticeSummary,
  type IWrongAnswer,
} from "./wrong-answer-shared";

function PracticeRow({
  practice,
  onOpen,
}: {
  practice: IRemedialPracticeSummary;
  onOpen: (view: "take" | "result") => void;
}) {
  const locale = getStudentLocale();
  const status = getRemedialPracticeStatus(practice);
  const statusLabel =
    status === "submitted"
      ? tStudent("wrong_answers_practice_status_submitted", undefined, locale)
      : status === "in_progress"
        ? tStudent("wrong_answers_practice_status_in_progress", undefined, locale)
        : tStudent("wrong_answers_practice_status_not_started", undefined, locale);
  const created = new Date(practice.created_at).toLocaleDateString(getStudentDateLocale(locale), {
    month: "numeric",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Wand2 size={15} className="text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-foreground">{practice.title}</p>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {statusLabel}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {tStudent("my_exams_questions", { count: practice.question_count }, locale)}
          <span className="px-1.5 opacity-40">·</span>
          {created}
          {status === "submitted" && practice.score !== null ? (
            <>
              <span className="px-1.5 opacity-40">·</span>
              {tStudent("wrong_answers_practice_score", { score: practice.score }, locale)}
            </>
          ) : null}
        </p>
      </div>
      <Button
        size="sm"
        variant={status === "submitted" ? "outline" : "default"}
        className="h-8 shrink-0 text-xs"
        onClick={() => onOpen(status === "submitted" ? "result" : "take")}
      >
        {status === "submitted"
          ? tStudent("wrong_answers_practice_view_result", undefined, locale)
          : tStudent("wrong_answers_practice_enter", undefined, locale)}
        <ChevronRight size={13} />
      </Button>
    </div>
  );
}

export function WrongAnswerExamPage() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const { examId } = useParams<{ examId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readWrongAnswerTab(searchParams.get("tab"));
  const [dialogOpen, setDialogOpen] = useState(false);

  const sourceKey = getWrongAnswerSourceKey(examId ?? null);
  const { analysis, isLoading: isAnalysisLoading } = useRemedialPracticeAnalysis(sourceKey);

  const { query } = useList<IWrongAnswer>({
    resource: "wrong-answers",
    pagination: { currentPage: 1, pageSize: 500 },
    sorters:
      tab === "mastered"
        ? [{ field: "mastered_at", order: "desc" }]
        : [{ field: "last_wrong_at", order: "desc" }],
    filters: [
      {
        field: "mastered",
        operator: "eq",
        value: tab === "mastered",
      },
    ],
  });

  const allItems = query.data?.data ?? [];
  const items = allItems.filter((item) =>
    examId === WRONG_ANSWER_LEGACY_EXAM_KEY ? !item.exam_id : item.exam_id === examId,
  );

  const first = items[0];
  const isPractice = first?.exam_category === "practice";
  const Icon = isPractice ? BookOpen : ClipboardList;
  const goBack = () => navigate(buildWrongAnswerListHref(tab));
  const practices = analysis?.practices ?? [];
  const canGenerate = (analysis?.groups.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} />
          {tStudent("wrong_answers_back", undefined, locale)}
        </button>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
              <Icon size={18} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-black tracking-tight text-foreground">
                  {first?.exam_title ?? tStudent("wrong_answers_exam_fallback_title", undefined, locale)}
                </h1>
                {first ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                      isPractice ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary",
                    )}
                  >
                    {getWrongAnswerCategoryLabel(first.exam_category, locale)}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {tStudent("wrong_answers_exam_count", { count: items.length }, locale)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {tab === "to_review" && canGenerate ? (
              <Button size="sm" className="h-9" onClick={() => setDialogOpen(true)}>
                <Sparkles size={14} />
                {tStudent("wrong_answers_practice_cta", undefined, locale)}
              </Button>
            ) : null}
            <div className="flex w-fit rounded-xl bg-muted/50 p-1">
              {[
                { key: "to_review" as const, label: tStudent("wrong_answers_tab_to_review", undefined, locale) },
                { key: "mastered" as const, label: tStudent("wrong_answers_tab_mastered", undefined, locale) },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSearchParams(t.key === "mastered" ? { tab: "mastered" } : {}, { replace: true })}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all",
                    tab === t.key
                      ? "bg-background text-primary shadow-sm ring-1 ring-border/50"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {practices.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-wide text-muted-foreground">
            {tStudent("wrong_answers_practice_existing", undefined, locale)}
          </h2>
          <div className="space-y-2">
            {practices.map((practice) => (
              <PracticeRow
                key={practice.id}
                practice={practice}
                onOpen={(view) =>
                  navigate(buildRemedialPracticeHref(sourceKey, practice.id, view))
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-border/40 bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/40 bg-muted/5 py-24">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
            <BookOpen size={32} className="text-muted-foreground/20" />
          </div>
          <p className="text-sm font-bold text-muted-foreground">
            {tStudent("wrong_answers_empty", undefined, locale)}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <WrongAnswerCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <RemedialPracticeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        analysis={analysis}
        isAnalysisLoading={isAnalysisLoading}
        onStarted={(practiceId) => {
          navigate(buildRemedialPracticeHref(sourceKey, practiceId, "take"));
        }}
      />
    </div>
  );
}
