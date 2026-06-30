import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ClassStudentSelector } from "@/pages/exams/components/ClassStudentSelector";
import { getPublishedExamStatus } from "@/pages/exams/components/exam-form-utils";
import type { IPaperDetail } from "@/types";

import { paperApiRequest } from "./api";

export type PaperQuickPublishMode = "exam" | "practice";

interface PaperQuickPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paper: IPaperDetail;
  mode: PaperQuickPublishMode;
  courseKpId?: string;
  courseSemesterId?: string;
  onPublished?: (examId: string) => void;
}

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_WINDOW_DAYS = 14;

function formatDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function PaperQuickPublishDialog({
  open,
  onOpenChange,
  paper,
  mode,
  courseKpId,
  courseSemesterId,
  onPublished,
}: PaperQuickPublishDialogProps) {
  const { toast } = useToast();
  const isExam = mode === "exam";

  const defaultTitle = useMemo(() => {
    const today = formatDate(new Date());
    return isExam ? `${paper.title} · ${today}` : `${paper.title} · ${today} 练习`;
  }, [paper.title, isExam]);

  const [title, setTitle] = useState(defaultTitle);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setStudentIds([]);
  }, [open, defaultTitle]);

  const canSubmit =
    title.trim().length > 0 && studentIds.length > 0 && !isSubmitting && paper.questions.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const now = new Date();
      const endAt = new Date(now.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const startIso = now.toISOString();
      const endIso = endAt.toISOString();

      const payload = {
        category: mode,
        title: title.trim(),
        description: paper.description ?? null,
        start_time: startIso,
        end_time: endIso,
        duration_minutes: DEFAULT_DURATION_MINUTES,
        total_score: paper.total_score,
        status: getPublishedExamStatus({ start_time: startIso, end_time: endIso }, now),
        question_mode: "manual",
        question_items: paper.questions.map((item, index) => ({
          question_id: item.question_id,
          order: item.order ?? index,
          score_override: item.score_override,
        })),
        question_ids: paper.questions.map((item) => item.question_id),
        student_ids: studentIds,
        ...(courseKpId ? { course_kp_id: courseKpId } : {}),
        ...(courseSemesterId ? { course_semester_id: courseSemesterId } : {}),
      };

      const created = await paperApiRequest<{ id: string }>("/exams", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      toast({
        title: isExam ? "考试已创建" : "练习已发布",
        description: `${title.trim()}（${studentIds.length} 名学生）`,
      });
      onOpenChange(false);
      onPublished?.(created.id);
    } catch (error) {
      toast({
        title: isExam ? "创建考试失败" : "发布练习失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const dialogTitle = isExam ? "快速创建考试" : "快速发布练习";
  const description = isExam
    ? `基于当前试卷发起一场正式考试，添加学生即可发布，其他设置稍后可在考试详情中调整。`
    : `基于当前试卷发布一次课堂练习，添加学生即可发布，其他设置稍后可在练习详情中调整。`;
  const submitLabel = isExam ? "创建考试" : "发布练习";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">{dialogTitle}</DialogTitle>
          <DialogDescription>
            {description}
            <span className="ml-1 text-muted-foreground/80">
              共 {paper.question_count} 题 · 总分 {paper.total_score} · 默认时长{" "}
              {DEFAULT_DURATION_MINUTES} 分钟 · 有效期 {DEFAULT_WINDOW_DAYS} 天
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="paper-quick-publish-title">
              {isExam ? "考试标题" : "练习标题"}
            </Label>
            <Input
              id="paper-quick-publish-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isExam ? "请输入考试标题" : "请输入练习标题"}
            />
          </div>

          <ClassStudentSelector
            selectedIds={studentIds}
            onChange={setStudentIds}
            summaryLabel={isExam ? "名考生" : "名学生"}
            emptySummaryText={
              isExam ? "请选择至少一名考生即可创建考试。" : "请选择至少一名学生即可发布练习。"
            }
            defaultSupplementCollapsed
          />
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isSubmitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
