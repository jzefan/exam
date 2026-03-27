import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { NotebookPen, BookOpen, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { QuestionType } from "../../types";

const questionTypeLabel: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

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
  const date = new Date(item.last_wrong_at).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });

  return (
    <Card
      className="hover:border-foreground/40 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => navigate(`/wrong-answers/${item.id}`)}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="secondary" className="text-xs">
                {questionTypeLabel[item.question_type] ?? item.question_type}
              </Badge>
              <span className="text-xs text-muted-foreground truncate">{item.exam_title}</span>
            </div>
            <p className="text-sm font-medium text-foreground line-clamp-2"
              dangerouslySetInnerHTML={{ __html: item.question_title }}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">错误次数</p>
              <p className="text-base font-bold text-red-500 dark:text-red-400">{item.wrong_count}</p>
            </div>
            <ChevronRight size={14} className="text-muted-foreground" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">最近错误：{date}</p>
      </CardContent>
    </Card>
  );
}

export function WrongAnswers() {
  const { query } = useList<IWrongAnswer>({
    resource: "wrong-answers",
    pagination: { currentPage: 1, pageSize: 50 },
    sorters: [{ field: "last_wrong_at", order: "desc" }],
  });

  const items = query.data?.data ?? [];
  const isLoading = query.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <NotebookPen size={22} />
          错题本
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">整理你在考试中答错的题目，帮助查漏补缺</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <BookOpen size={40} className="mb-3 opacity-30" />
          <p className="text-sm">暂无错题记录</p>
          <p className="text-xs mt-1 opacity-70">完成考试后，答错的题目会自动收录到这里</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => <WrongAnswerCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
