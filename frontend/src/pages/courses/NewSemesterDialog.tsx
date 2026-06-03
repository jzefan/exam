import { useEffect, useState } from "react";
import { Check, Loader2, Users } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import type { StudentImportClassOption } from "@/components/students/student-import-utils";

import { createCourseSemester, type CourseSemester } from "./api";

interface NewSemesterDialogProps {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (semester: CourseSemester) => void;
}

export function NewSemesterDialog({
  courseId,
  open,
  onOpenChange,
  onCreated,
}: NewSemesterDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [semesterMajorLabel, setSemesterMajorLabel] = useState("");
  const [semesterMajorDescription, setSemesterMajorDescription] = useState("");
  const [description, setDescription] = useState("");
  const [classes, setClasses] = useState<StudentImportClassOption[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setLoadingClasses(true);
      apiRequest<StudentImportClassOption[]>("/rbac/students/classes")
        .then(setClasses)
        .catch((error) => {
          toast({
            title: "班级加载失败",
            description: error instanceof Error ? error.message : "请稍后重试",
            variant: "destructive",
          });
        })
        .finally(() => setLoadingClasses(false));
    } else {
      setName("");
      setSemesterMajorLabel("");
      setSemesterMajorDescription("");
      setDescription("");
      setSelectedClassIds([]);
      setSubmitting(false);
    }
  }, [open, toast]);

  const canSubmit = name.trim().length > 0 && !submitting;
  const selectedClassSet = new Set(selectedClassIds);

  const toggleClass = (classId: string) => {
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const semester = await createCourseSemester(courseId, {
        name: name.trim(),
        description: description.trim() || null,
        semester_major_label: semesterMajorLabel.trim() || null,
        semester_major_description: semesterMajorDescription.trim() || null,
        class_ids: selectedClassIds,
        start_date: null,
        end_date: null,
      });
      toast({ title: "学期已创建", description: `已新建学期《${semester.name}》` });
      onCreated(semester);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!submitting ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">新建学期</DialogTitle>
          <DialogDescription>
            设置本学期的专业标签与班级；这是学期维度标签，不关联课程所属专业/方向。
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-semester-name">学期名称</Label>
            <Input
              id="new-semester-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：2026 春季"
              autoFocus
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-semester-major-label">专业标签</Label>
            <Input
              id="new-semester-major-label"
              value={semesterMajorLabel}
              onChange={(event) => setSemesterMajorLabel(event.target.value)}
              placeholder="如：2026年第2学期-A专业"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              仅用于区分本学期教学对象，不等同于课程目录中的专业/方向。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-semester-major-label-desc">专业标签描述</Label>
            <Textarea
              id="new-semester-major-label-desc"
              value={semesterMajorDescription}
              onChange={(event) => setSemesterMajorDescription(event.target.value)}
              placeholder="如：A专业本学期使用该课程作为 Python 程序设计基础课。"
              rows={2}
              maxLength={2000}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>班级</Label>
              {selectedClassIds.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  已选择 {selectedClassIds.length} 个班级
                </span>
              ) : null}
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              {loadingClasses ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载班级...
                </div>
              ) : classes.length === 0 ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Users className="size-4" />
                  暂无可选班级，可先到学生管理中创建班级。
                </div>
              ) : (
                <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                  {classes.map((item) => {
                    const selected = selectedClassSet.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleClass(item.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5",
                        )}
                      >
                        {selected ? <Check className="size-3.5" /> : <Users className="size-3.5" />}
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-semester-desc">备注（可选）</Label>
            <Textarea
              id="new-semester-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="如：面向 25 级软工 1-3 班"
              rows={2}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
