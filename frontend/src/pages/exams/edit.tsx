import { useState } from "react";
import { useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PositionSelector } from "./components/PositionSelector";
import { QuestionSelector } from "./components/QuestionSelector";
import { StudentSelector } from "./components/StudentSelector";
import { examStatusOptions } from "./components/ExamStatusBadge";
import type { ExamStatus, IExamQuestion, IExamStudent } from "@/types";
import {
  DEFAULT_NOTES,
  getErrorMessage,
  type ExamFormValues as ExamForm,
  validateExamForm,
} from "./components/exam-form-utils";

type ExamDetail = ExamForm & {
  questions: IExamQuestion[];
  students: IExamStudent[];
};

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toExamForm(exam: ExamDetail): ExamForm {
  return {
    title: exam.title,
    description: exam.description || "",
    start_time: toLocalDatetime(exam.start_time),
    end_time: toLocalDatetime(exam.end_time),
    duration_minutes: exam.duration_minutes,
    total_score: exam.total_score,
    status: exam.status,
    position_id: exam.position_id || null,
    max_switch_count: exam.max_switch_count ?? 0,
    show_result: exam.show_result ?? false,
    notes_template: exam.notes_template || "",
    question_ids: exam.questions.map((q) => q.question_id),
    student_ids: exam.students.map((s) => s.student_id),
  };
}

function ExamEditForm({ id, exam }: { id: string; exam: ExamDetail }) {
  const navigate = useNavigate();
  const { mutate: update, mutation } = useUpdate();
  const isPending = mutation.isPending;
  const [form, setForm] = useState<ExamForm>(() => toExamForm(exam));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const validationErrors = validateExamForm(form);

  const updateField = <K extends keyof ExamForm>(key: K, value: ExamForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isLocked = form.status === "ongoing" || form.status === "completed" || form.status === "closed";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidationErrors(true);
    setSubmitError(null);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    update(
      {
        resource: "exams",
        id,
        values: {
          ...form,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          notes_template: form.notes_template || null,
          position_id: form.position_id || null,
        },
      },
      {
        onSuccess: () => navigate("/exams"),
        onError: (error) => {
          setSubmitError(getErrorMessage(error, "保存考试失败，请稍后重试。"));
        },
      },
    );
  };

  const fieldErrors = showValidationErrors ? validationErrors : {};
  const hasBlockingErrors = Object.keys(validationErrors).length > 0;

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="返回考试列表"
          onClick={() => navigate("/exams")}
        >
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-base font-bold text-foreground tracking-tight">
            编辑考试
          </h1>
          <p className="text-sm text-muted-foreground">修改考试信息、题目和考生</p>
        </div>
      </div>

      {(submitError || hasBlockingErrors) && showValidationErrors && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {submitError ?? "请先修正表单中的错误信息后再保存。"}
        </div>
      )}

      {isLocked && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-300">
          考试当前状态为「{examStatusOptions.find((o) => o.value === form.status)?.label}」，部分设置可能无法修改
        </div>
      )}

      {/* Tabbed form */}
      <Tabs defaultValue="basic" className="w-full">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="min-w-max justify-start">
            <TabsTrigger value="basic" className="min-h-10">基本信息</TabsTrigger>
            <TabsTrigger value="questions" className="min-h-10">
              选择题目
              {form.question_ids.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                  {form.question_ids.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="students" className="min-h-10">
              考试考生
              {form.student_ids.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                  {form.student_ids.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="min-h-10">考试设置</TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Basic info */}
        <TabsContent value="basic" className="mt-6">
          <div className="max-w-2xl space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="exam-status">考试状态</Label>
              <Select
                value={form.status}
                onValueChange={(val) => updateField("status", val as ExamStatus)}
              >
                <SelectTrigger id="exam-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {examStatusOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exam-title">考试名称 *</Label>
              <Input
                id="exam-title"
                placeholder="请输入考试名称"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={fieldErrors.title ? "exam-title-error" : undefined}
              />
              {fieldErrors.title && (
                <p id="exam-title-error" className="text-xs text-destructive">
                  {fieldErrors.title}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exam-description">考试描述</Label>
              <Textarea
                id="exam-description"
                placeholder="请输入考试描述（可选）"
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exam-position">岗位</Label>
              <PositionSelector
                id="exam-position"
                value={form.position_id}
                onChange={(id) => updateField("position_id", id)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exam-start-time">开始时间</Label>
                <Input
                  id="exam-start-time"
                  type="datetime-local"
                  value={form.start_time}
                  onChange={(e) => updateField("start_time", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.start_time)}
                  aria-describedby={fieldErrors.start_time ? "exam-start-time-error" : undefined}
                />
                {fieldErrors.start_time && (
                  <p id="exam-start-time-error" className="text-xs text-destructive">
                    {fieldErrors.start_time}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exam-end-time">结束时间</Label>
                <Input
                  id="exam-end-time"
                  type="datetime-local"
                  value={form.end_time}
                  onChange={(e) => updateField("end_time", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.end_time)}
                  aria-describedby={fieldErrors.end_time ? "exam-end-time-error" : undefined}
                />
                {fieldErrors.end_time && (
                  <p id="exam-end-time-error" className="text-xs text-destructive">
                    {fieldErrors.end_time}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exam-duration">考试时长（分钟）</Label>
                <Input
                  id="exam-duration"
                  type="number"
                  min={1}
                  value={form.duration_minutes}
                  onChange={(e) =>
                    updateField("duration_minutes", parseInt(e.target.value) || 60)
                  }
                  aria-invalid={Boolean(fieldErrors.duration_minutes)}
                  aria-describedby={fieldErrors.duration_minutes ? "exam-duration-error" : undefined}
                />
                {fieldErrors.duration_minutes && (
                  <p id="exam-duration-error" className="text-xs text-destructive">
                    {fieldErrors.duration_minutes}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exam-total-score">总分</Label>
                <Input
                  id="exam-total-score"
                  type="number"
                  min={1}
                  value={form.total_score}
                  onChange={(e) =>
                    updateField("total_score", parseFloat(e.target.value) || 100)
                  }
                  aria-invalid={Boolean(fieldErrors.total_score)}
                  aria-describedby={fieldErrors.total_score ? "exam-total-score-error" : undefined}
                />
                {fieldErrors.total_score && (
                  <p id="exam-total-score-error" className="text-xs text-destructive">
                    {fieldErrors.total_score}
                  </p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Questions */}
        <TabsContent value="questions" className="mt-6">
          <div className="max-w-3xl">
            <QuestionSelector
              selectedIds={form.question_ids}
              onChange={(ids) => updateField("question_ids", ids)}
            />
          </div>
        </TabsContent>

        {/* Tab 3: Students */}
        <TabsContent value="students" className="mt-6">
          <div className="max-w-3xl">
            <StudentSelector
              selectedIds={form.student_ids}
              onChange={(ids) => updateField("student_ids", ids)}
            />
          </div>
        </TabsContent>

        {/* Tab 4: Settings */}
        <TabsContent value="settings" className="mt-6">
          <div className="max-w-2xl space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="exam-max-switch-count">允许切屏次数</Label>
              <Input
                id="exam-max-switch-count"
                type="number"
                min={0}
                value={form.max_switch_count}
                onChange={(e) =>
                  updateField("max_switch_count", parseInt(e.target.value) || 0)
                }
                aria-invalid={Boolean(fieldErrors.max_switch_count)}
                aria-describedby="exam-max-switch-count-help"
              />
              <p id="exam-max-switch-count-help" className="text-xs text-muted-foreground">
                设为 0 表示不限制切屏次数
              </p>
              {fieldErrors.max_switch_count && (
                <p className="text-xs text-destructive">{fieldErrors.max_switch_count}</p>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label htmlFor="exam-show-result">允许查看考试结果</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  考生提交后是否可以查看批改结果详情
                </p>
              </div>
              <Switch
                id="exam-show-result"
                checked={form.show_result}
                onCheckedChange={(checked) => updateField("show_result", checked)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="exam-notes">考试注意事项</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => updateField("notes_template", DEFAULT_NOTES)}
                >
                  使用默认模板
                </Button>
              </div>
              <Textarea
                id="exam-notes"
                placeholder="请输入考试注意事项..."
                value={form.notes_template}
                onChange={(e) => updateField("notes_template", e.target.value)}
                rows={8}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <Separator />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={() => navigate("/exams")}>
          取消
        </Button>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={!form.title.trim() || isPending}
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              保存中...
            </span>
          ) : (
            <>
              <Save size={16} className="mr-1" />
              保存修改
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export function ExamEdit() {
  const { id } = useParams<{ id: string }>();

  const { result: exam, query } = useOne<ExamDetail>({
    resource: "exams",
    id: id!,
  });

  if (query.isLoading || !exam) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return <ExamEditForm id={id!} exam={exam} />;
}
