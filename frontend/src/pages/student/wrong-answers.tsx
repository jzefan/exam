import { useState } from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, AlertCircle, Calendar, CheckCircle2 } from "lucide-react";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { QuestionType } from "../../types";
import { getStudentDateLocale, getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "./i18n";

interface IWrongAnswer {
  id: string;
  question_id: string;
  question_title: string;
  question_type: QuestionType;
  exam_title: string;
  wrong_count: number;
  last_wrong_at: string;
  mastered_at: string | null;
  mastered: boolean;
  tags: string[];
}

type TabKey = "to_review" | "mastered";

function WrongAnswerCard({ item }: { item: IWrongAnswer }) {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  
  const displayDate = item.mastered && item.mastered_at ? item.mastered_at : item.last_wrong_at;
  const dateStr = new Date(displayDate).toLocaleDateString(getStudentDateLocale(locale), {
    month: "numeric",
    day: "numeric",
  });

  // Intensity of error based on count
  const severityColor =
    item.wrong_count >= 3 ? "text-destructive" : item.wrong_count >= 2 ? "text-primary" : "text-muted-foreground";
  const severityBg =
    item.wrong_count >= 3 ? "bg-destructive/10" : item.wrong_count >= 2 ? "bg-primary/10" : "bg-muted";

  return (
    <Card
      className="group cursor-pointer overflow-hidden rounded-2xl border-border/50 bg-card/50 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
      onClick={() => navigate(`/wrong-answers/${item.id}`)}
    >
      <CardContent className="p-0">
        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {getStudentQuestionTypeLabel(item.question_type, locale)}
              </Badge>

              {item.mastered ? (
                <div className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700 shadow-sm shadow-emerald-200/50">
                  <CheckCircle2 size={10} />
                  {locale === "en" ? "Mastered" : "已掌握"}
                </div>
              ) : (
                <div className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black shadow-sm", severityBg, severityColor)}>
                  <AlertCircle size={10} />
                  {tStudent("wrong_answers_wrong_times", { count: item.wrong_count }, locale)}
                </div>
              )}
            </div>

            <p className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground/90 transition-colors group-hover:text-primary"
              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(item.question_title) }}
            />

            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 items-center gap-2 truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                <BookOpen size={12} className="shrink-0 opacity-40" />
                <span className="truncate">{item.exam_title}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
                <Calendar size={12} className="shrink-0 opacity-40" />
                <span>
                  {item.mastered
                    ? tStudent("wrong_answers_mastered_at", { date: dateStr }, locale)
                    : tStudent("wrong_answers_date", { date: dateStr }, locale)
                  }
                </span>
              </div>

              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.slice(0, 3).map((tag, idx) => (
                    <span key={idx} className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden size-8 items-center justify-center rounded-full bg-muted/30 transition-colors group-hover:bg-primary/10 sm:flex">
            <ChevronRight size={14} className="text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WrongAnswers() {
  const locale = getStudentLocale();
  const [tab, setTab] = useState<TabKey>("to_review");

  const { query } = useList<IWrongAnswer>({
    resource: "wrong-answers",
    pagination: { currentPage: 1, pageSize: 50 },
    sorters: tab === "mastered" ? [{ field: "mastered_at", order: "desc" }] : [{ field: "last_wrong_at", order: "desc" }],
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

  return (
    <div className="space-y-10">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-lg font-black text-foreground tracking-tight">{tStudent("wrong_answers_title", undefined, locale)}</h1>
          <p className="text-sm font-medium text-muted-foreground">
            {tab === "mastered" 
              ? tStudent("wrong_answers_mastered_summary", { count: items.length }, locale)
              : tStudent("wrong_answers_summary", { count: items.length }, locale)}
          </p>
        </div>

        <div className="flex w-fit shrink-0 rounded-xl bg-muted/50 p-1">
          {[
            { key: "to_review" as const, label: tStudent("wrong_answers_tab_to_review", undefined, locale) },
            { key: "mastered" as const, label: tStudent("wrong_answers_tab_mastered", undefined, locale) }
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all",
                tab === t.key ? "bg-background text-primary shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-border/40 bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 rounded-3xl border-2 border-dashed border-border/40 bg-muted/5">
          <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <BookOpen size={32} className="text-muted-foreground/20" />
          </div>
          <p className="text-sm font-bold text-muted-foreground">{tStudent("wrong_answers_empty", undefined, locale)}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{tStudent("wrong_answers_empty_desc", undefined, locale)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => <WrongAnswerCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
