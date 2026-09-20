import { useMemo } from "react";
import { useList } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStudentDateLocale, getStudentLocale, tStudent } from "./i18n";
import {
  buildWrongAnswerExamGroups,
  buildWrongAnswerExamHref,
  getWrongAnswerCategoryLabel,
  readWrongAnswerTab,
  WRONG_ANSWER_LEGACY_EXAM_KEY,
  type IWrongAnswer,
  type IWrongAnswerExamGroup,
} from "./wrong-answer-shared";

function ExamGroupRow({ group, onOpen }: { group: IWrongAnswerExamGroup; onOpen: () => void }) {
  const locale = getStudentLocale();
  const isPractice = group.category === "practice";
  const Icon = isPractice ? BookOpen : ClipboardList;
  const dateStr = new Date(group.lastAt).toLocaleDateString(getStudentDateLocale(locale), {
    month: "numeric",
    day: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl border border-border/50 bg-card/50 px-4 py-4 text-left transition-all hover:border-primary/30 hover:bg-primary/[0.01] hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted transition-colors group-hover:bg-primary/10">
        <Icon size={18} className="text-muted-foreground transition-colors group-hover:text-primary" />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
              isPractice ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary",
            )}
          >
            {getWrongAnswerCategoryLabel(group.category, locale)}
          </span>
          <h3 className="truncate text-sm font-bold text-foreground">{group.title}</h3>
        </div>
        <p className="text-[11px] font-semibold text-muted-foreground">
          {tStudent("wrong_answers_exam_count", { count: group.questionCount }, locale)}
          <span className="px-1.5 opacity-40">·</span>
          {tStudent("wrong_answers_last_wrong", { date: dateStr }, locale)}
          {group.remedialPracticeCount > 0 ? (
            <>
              <span className="px-1.5 opacity-40">·</span>
              <span className="text-primary">
                {tStudent(
                  "wrong_answers_practice_badge",
                  { count: group.remedialPracticeCount },
                  locale,
                )}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <ChevronRight
        size={16}
        className="shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </button>
  );
}

export function WrongAnswers() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readWrongAnswerTab(searchParams.get("tab"));

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

  const items = query.data?.data ?? [];
  const isLoading = query.isLoading;
  const groups = useMemo(() => buildWrongAnswerExamGroups(items, tab), [items, tab]);

  return (
    <div className="space-y-10">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="space-y-2">
          <h1 className="text-lg font-black tracking-tight text-foreground">
            {tStudent("wrong_answers_title", undefined, locale)}
          </h1>
          <p className="text-sm font-medium text-muted-foreground">
            {tab === "mastered"
              ? tStudent("wrong_answers_mastered_summary", { count: items.length }, locale)
              : tStudent("wrong_answers_summary", { count: items.length }, locale)}
          </p>
        </div>

        <div className="flex w-fit shrink-0 rounded-xl bg-muted/50 p-1">
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
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl border border-border/40 bg-muted" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/40 bg-muted/5 py-32">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
            <BookOpen size={32} className="text-muted-foreground/20" />
          </div>
          <p className="text-sm font-bold text-muted-foreground">
            {tStudent("wrong_answers_empty", undefined, locale)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {tStudent("wrong_answers_empty_desc", undefined, locale)}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <ExamGroupRow
              key={group.examId ?? WRONG_ANSWER_LEGACY_EXAM_KEY}
              group={group}
              onOpen={() => navigate(buildWrongAnswerExamHref(group.examId, tab))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
