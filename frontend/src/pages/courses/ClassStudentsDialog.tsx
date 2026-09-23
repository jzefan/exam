import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/pages/grading/api";

interface ClassStudent {
  id: string;
  full_name: string;
  username: string;
  phone?: string | null;
  student_id?: string | null;
}

interface ClassStudentsDialogProps {
  classId: string | null;
  className: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClassStudentsDialog({
  classId,
  className,
  open,
  onOpenChange,
}: ClassStudentsDialogProps) {
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !classId) return;

    let active = true;
    setLoading(true);
    setError(null);
    void apiRequest<ClassStudent[]>(
      `/rbac/students?class_id=${encodeURIComponent(classId)}`,
    )
      .then((data) => {
        if (active) setStudents(data);
      })
      .catch((requestError) => {
        if (active) {
          setStudents([]);
          setError(requestError instanceof Error ? requestError.message : "班级人员加载失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [classId, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(680px,88vh)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{className} · 班级人员</DialogTitle>
          <DialogDescription>
            {loading ? "正在加载班级人员…" : `共 ${students.length} 名学生`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在加载...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
              {error}
            </div>
          ) : students.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              <Users className="size-6" />
              该班级暂无学生
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {(student.full_name || student.username).slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {student.full_name || student.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {student.student_id || student.phone || student.username}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
