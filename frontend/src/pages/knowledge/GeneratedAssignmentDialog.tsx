import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  ClassStudentSelector,
  type StudentSemesterOption,
} from "@/pages/exams/components/ClassStudentSelector";
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
  /** 「按学期选择」里点中的学期（没点过为 null），由宿主决定归档到哪个学期。 */
  semesterId?: string | null;
}

interface GeneratedAssignmentDialogProps {
  open: boolean;
  defaultTitle: string;
  questionCount: number;
  defaultClassIds?: string[];
  /** 本课程的学期列表；传入后可选学期一键选中该学期关联班级的学生。 */
  semesterOptions?: StudentSemesterOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GeneratedAssignmentDialogSubmitPayload) => Promise<void>;
}

export function GeneratedAssignmentDialog({
  open,
  defaultTitle,
  questionCount,
  defaultClassIds,
  semesterOptions,
  onOpenChange,
  onSubmit,
}: GeneratedAssignmentDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  // 「按学期选择」里点中的学期；没点过就沿用课程默认学期。
  const [semesterOverride, setSemesterOverride] = useState<string | null>(null);
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
        semesterId: semesterOverride,
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
            semesterOptions={semesterOptions}
            onSemesterChange={setSemesterOverride}
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
