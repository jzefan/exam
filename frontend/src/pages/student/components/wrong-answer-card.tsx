import { useNavigate } from "react-router-dom";
import { AlertCircle, Calendar, CheckCircle2, ChevronRight, ListOrdered } from "lucide-react";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getStudentDateLocale, getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "../i18n";
import type { IWrongAnswer } from "../wrong-answer-shared";

export function WrongAnswerCard({ item }: { item: IWrongAnswer }) {
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
              {item.exam_question_order != null ? (
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-muted-foreground/40">
                  <ListOrdered size={12} className="shrink-0 opacity-40" />
                  <span>
                    {tStudent("result_question_number", { number: item.exam_question_order + 1 }, locale)}
                  </span>
                </div>
              ) : null}

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
