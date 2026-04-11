import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, AlertCircle, Calendar, Hash } from "lucide-react";
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
}

function WrongAnswerCard({ item }: { item: IWrongAnswer }) {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const date = new Date(item.last_wrong_at).toLocaleDateString(getStudentDateLocale(locale), {
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
      className="group hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 cursor-pointer rounded-2xl overflow-hidden"
      onClick={() => navigate(`/wrong-answers/${item.id}`)}
    >
      <CardContent className="p-0">
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wider rounded-md">
                {getStudentQuestionTypeLabel(item.question_type, locale)}
              </Badge>
              <span className="text-[10px] font-bold text-muted-foreground/60 truncate max-w-[120px] uppercase tracking-widest">{item.exam_title}</span>
            </div>
            <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black", severityBg, severityColor)}>
              <AlertCircle size={10} />
              {tStudent("wrong_answers_wrong_times", { count: item.wrong_count }, locale)}
            </div>
          </div>

          <div className="min-h-[3rem]">
            <p className="text-sm font-bold text-foreground/90 line-clamp-2 leading-relaxed group-hover:text-primary transition-colors"
              dangerouslySetInnerHTML={{ __html: item.question_title }}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">
              <span className="flex items-center gap-1"><Calendar size={12} /> {tStudent("wrong_answers_date", { date }, locale)}</span>
              <span className="flex items-center gap-1"><Hash size={12} /> {tStudent("wrong_answers_id", { id: item.question_id.slice(0, 6) }, locale)}</span>
            </div>
            <ChevronRight size={14} className="text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WrongAnswers() {
  const locale = getStudentLocale();
  const { query } = useList<IWrongAnswer>({
    resource: "wrong-answers",
    pagination: { currentPage: 1, pageSize: 50 },
    sorters: [{ field: "last_wrong_at", order: "desc" }],
  });

  const items = query.data?.data ?? [];
  const isLoading = query.isLoading;

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-lg font-black text-foreground tracking-tight">{tStudent("wrong_answers_title", undefined, locale)}</h1>
        <p className="text-sm font-medium text-muted-foreground">{tStudent("wrong_answers_summary", { count: items.length }, locale)}</p>
      </header>

      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-muted animate-pulse border border-border/40" />
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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => <WrongAnswerCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
