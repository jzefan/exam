import { useEffect, useMemo, useState } from "react";
import { FileCheck, FilePlus2, GraduationCap, Loader2, NotebookPen } from "lucide-react";
import { isAxiosError } from "axios";

import { apiClient } from "@/lib/api";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ClassStudentSelector } from "@/pages/exams/components/ClassStudentSelector";
import { getPublishedExamStatus } from "@/pages/exams/components/exam-form-utils";

export type CreateFromSelectionCategory = "exam" | "practice";

export interface SelectedQuestionSummary {
  id: string;
  type: string;
  /** 原始总分（`question.score`），用于合计和默认分值。 */
  score: number;
}

export interface CreateFromSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已选题目摘要，用于展示"共 X 道题，总分 Y" 并作为发布时的题目来源。 */
  selected: SelectedQuestionSummary[];
  /** 成功创建后的回调，通常由宿主页做跳转（如 navigate("/exams")）。 */
  onPublished?: (examId: string, category: CreateFromSelectionCategory) => void;
  /** 从课程工作台发起时，把考试/练习直接归属到当前课程。 */
  courseKpId?: string | null;
  /** 从课程某个学期发起时，创建后直接归档到该学期。 */
  courseSemesterId?: string | null;
  /** 当前学期已关联的班级；打开时默认选中这些班级下的学生。 */
  defaultClassIds?: string[];
  /** 默认类型，默认为练习（老师日常场景更常见）。 */
  defaultCategory?: CreateFromSelectionCategory;
  /** 名称的默认值，通常由宿主生成，例如 "2026-05-11 练习"。 */
  defaultTitle?: string;
}

const TYPE_LABELS: Record<string, string> = {
  choice: "选择",
  true_false: "判断",
  fill_in: "填空",
  short_answer: "简答",
  essay: "论述",
  code: "编程",
};

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_WINDOW_DAYS = 14;

function describeTypes(selected: SelectedQuestionSummary[]): string {
  if (selected.length === 0) return "";
  const counts = new Map<string, number>();
  for (const q of selected) {
    counts.set(q.type, (counts.get(q.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => `${TYPE_LABELS[type] ?? type} ${count}`)
    .join(" · ");
}

function sumScore(selected: SelectedQuestionSummary[]): number {
  return selected.reduce((s, q) => s + (Number.isFinite(q.score) ? q.score : 0), 0);
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * 从题目列表一步到位发起"考试 / 练习"的小对话框。
 *
 * 不再进入多步向导 —— 内嵌了学生选择器，默认值（时长、总分、开放期）由前端自动
 * 给出，合理即发布。创建后把控制权交还宿主（如跳转到考试列表）。
 */
export function CreateFromSelectionDialog({
  open,
  onOpenChange,
  selected,
  onPublished,
  courseKpId,
  courseSemesterId,
  defaultClassIds,
  defaultCategory = "practice",
  defaultTitle = "",
}: CreateFromSelectionDialogProps) {
  const { toast } = useToast();
  const [category, setCategory] = useState<CreateFromSelectionCategory>(defaultCategory);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 每次打开时以 props 为准刷新默认值，避免上次残留。
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory);
      setTitle(defaultTitle);
      setDescription("");
      setStudentIds([]);
    }
  }, [open, defaultCategory, defaultTitle]);

  const typesSummary = useMemo(() => describeTypes(selected), [selected]);
  const totalScore = useMemo(() => sumScore(selected), [selected]);
  const trimmedTitle = title.trim();
  const canSubmit =
    selected.length > 0 && trimmedTitle.length > 0 && studentIds.length > 0 && !submitting;

  const isExam = category === "exam";
  const submitLabel = isExam ? "创建考试" : "发布练习";
  const actionNoun = isExam ? "考试" : "练习";

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const now = new Date();
      const endAt = new Date(now.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const startIso = now.toISOString();
      const endIso = endAt.toISOString();

      const payload = {
        category,
        title: trimmedTitle,
        description: description.trim() || null,
        start_time: startIso,
        end_time: endIso,
        duration_minutes: DEFAULT_DURATION_MINUTES,
        total_score: totalScore > 0 ? totalScore : 100,
        status: getPublishedExamStatus({ start_time: startIso, end_time: endIso }, now),
        question_mode: "manual",
        question_items: selected.map((q, index) => ({
          question_id: q.id,
          order: index,
          score_override: Number.isFinite(q.score) ? q.score : null,
        })),
        question_ids: selected.map((q) => q.id),
        student_ids: studentIds,
        course_kp_id: courseKpId ?? undefined,
        course_semester_id: courseSemesterId ?? undefined,
      };

      const response = await apiClient.post<{ id: string }>("/api/exams", payload);

      toast({
        title: isExam ? "考试已创建" : "练习已发布",
        description: `${trimmedTitle}（${studentIds.length} 名学生）`,
      });
      onOpenChange(false);
      onPublished?.(response.data.id, category);
    } catch (error) {
      toast({
        title: isExam ? "创建考试失败" : "发布练习失败",
        description: extractErrorMessage(error, "请稍后重试"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5 text-primary" />
            从已选题目{isExam ? "创建考试" : "发布练习"}
          </DialogTitle>
          <DialogDescription>
            共 {selected.length} 道题目{typesSummary ? `（${typesSummary}）` : ""}，总分{" "}
            {totalScore.toFixed(totalScore % 1 === 0 ? 0 : 1)}。
            <span className="ml-1 text-muted-foreground/80">
              默认时长 {DEFAULT_DURATION_MINUTES} 分钟 · 有效期 {DEFAULT_WINDOW_DAYS} 天，创建后可在{actionNoun}详情中调整。
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label>类型</Label>
            <Tabs
              value={category}
              onValueChange={(value) => setCategory(value as CreateFromSelectionCategory)}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="practice">
                  <NotebookPen data-icon className="h-4 w-4" />
                  练习
                </TabsTrigger>
                <TabsTrigger value="exam">
                  <GraduationCap data-icon className="h-4 w-4" />
                  正式考试
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {category === "practice"
                ? "日常布置的练习，可按知识点反馈学习情况。"
                : "正式评测场景，默认不立即公开成绩，支持时间和切屏限制。"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-from-selection-title">名称</Label>
            <Input
              id="create-from-selection-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isExam ? "如：数据结构期中测验" : "如：2026-05-11 练习"}
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-from-selection-description">描述（可选）</Label>
            <Input
              id="create-from-selection-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="对学生可见的一段说明"
              maxLength={500}
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
            defaultClassIds={defaultClassIds}
          />

          {selected.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <FileCheck className="h-3.5 w-3.5" />
              请先选择至少一道题目。
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
