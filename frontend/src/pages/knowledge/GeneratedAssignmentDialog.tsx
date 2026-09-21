import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ClassStudentSelector } from "@/pages/exams/components/ClassStudentSelector";
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

export interface GeneratedAssignmentDialogSubmitPayload {
  title: string;
  studentIds: string[];
}

interface GeneratedAssignmentDialogProps {
  open: boolean;
  defaultTitle: string;
  questionCount: number;
  defaultClassIds?: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GeneratedAssignmentDialogSubmitPayload) => Promise<void>;
}

export function GeneratedAssignmentDialog({
  open,
  defaultTitle,
  questionCount,
  defaultClassIds,
  onOpenChange,
  onSubmit,
}: GeneratedAssignmentDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(defaultTitle);
    setStudentIds([]);
  }, [defaultTitle, open]);

  const canSubmit = title.trim().length > 0 && studentIds.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        studentIds,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base">生成练习</DialogTitle>
          <DialogDescription>将发布 {questionCount} 道题</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="generated-assignment-title">练习标题</Label>
            <Input
              id="generated-assignment-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="请输入练习标题"
            />
          </div>

          <ClassStudentSelector
            selectedIds={studentIds}
            onChange={setStudentIds}
            summaryLabel="名学生"
            emptySummaryText="请选择至少一名学生发布练习。"
            defaultSupplementCollapsed
            defaultClassIds={defaultClassIds}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : null}
            发布练习
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
