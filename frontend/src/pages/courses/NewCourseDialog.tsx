import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_MAJOR_DISPLAY_NAME } from "@/lib/knowledge-display";

import { createTeacherCourse, type TeacherCourseSummary } from "./api";

interface NewCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (course: TeacherCourseSummary) => void;
}

export function NewCourseDialog({
  open,
  onOpenChange,
  onCreated,
}: NewCourseDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const course = await createTeacherCourse({
        name: name.trim(),
        description: description.trim() || null,
      });
      toast({
        title: "课程已创建",
        description: `已在「${DEFAULT_MAJOR_DISPLAY_NAME}」下创建《${course.name}》，可在「我的课程」中继续维护。`,
      });
      onCreated(course);
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
    <Dialog
      open={open}
      onOpenChange={(next) => (!submitting ? onOpenChange(next) : undefined)}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">新建课程</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-course-name">课程名称</Label>
            <Input
              id="new-course-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：Python 程序设计"
              autoFocus
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-course-desc">课程说明（可选）</Label>
            <Textarea
              id="new-course-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="一句话描述这门课程的覆盖范围或目标学生"
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
