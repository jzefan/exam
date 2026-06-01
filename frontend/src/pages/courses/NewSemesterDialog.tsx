import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { createCourseSemester, type CourseSemester } from "./api";

interface NewSemesterDialogProps {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (semester: CourseSemester) => void;
}

export function NewSemesterDialog({ courseId, open, onOpenChange, onCreated }: NewSemesterDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (startDate && endDate && startDate > endDate) {
      toast({ title: "日期范围不合法", description: "结束日期不能早于开始日期", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const semester = await createCourseSemester(courseId, {
        name: name.trim(),
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">新建学期</DialogTitle>
          <DialogDescription>
            课程内容跨多个学期复用；作业、考试都归到具体学期，题目库始终跟课程走。
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-semester-start">开始日期</Label>
              <Input
                id="new-semester-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-semester-end">结束日期</Label>
              <Input
                id="new-semester-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
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
