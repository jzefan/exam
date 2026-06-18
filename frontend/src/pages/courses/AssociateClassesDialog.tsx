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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import type { StudentImportClassOption } from "@/components/students/student-import-utils";

import {
  updateCourseSemesterClasses,
  type CourseSemester,
} from "./api";

interface AssociateClassesDialogProps {
  courseId: string;
  semesters: CourseSemester[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 默认选中的学期（来自课程详情顶部所选学期）；为空时取第一个学期。 */
  defaultSemesterId?: string | null;
  onUpdated: (semester: CourseSemester) => void;
}

export function AssociateClassesDialog({
  courseId,
  semesters,
  open,
  onOpenChange,
  defaultSemesterId,
  onUpdated,
}: AssociateClassesDialogProps) {
  const { toast } = useToast();
  const [semesterId, setSemesterId] = useState("");
  const [classes, setClasses] = useState<StudentImportClassOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [saving, setSaving] = useState(false);

  // 打开时确定目标学期并拉取班级列表（来自学生管理）。
  useEffect(() => {
    if (!open) return;
    const initialId =
      (defaultSemesterId && semesters.some((s) => s.id === defaultSemesterId)
        ? defaultSemesterId
        : semesters[0]?.id) ?? "";
    setSemesterId(initialId);
    setLoadingClasses(true);
    apiRequest<StudentImportClassOption[]>("/rbac/students/classes")
      .then(setClasses)
      .catch(() => setClasses([]))
      .finally(() => setLoadingClasses(false));
  }, [open, defaultSemesterId, semesters]);

  // 切换学期时，预选该学期已关联的班级。
  useEffect(() => {
    if (!open || !semesterId) return;
    const sem = semesters.find((s) => s.id === semesterId);
    setSelectedIds((sem?.class_ids as string[] | undefined) ?? []);
  }, [open, semesterId, semesters]);

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleSave = async () => {
    if (!semesterId) return;
    setSaving(true);
    try {
      const updated = await updateCourseSemesterClasses(
        courseId,
        semesterId,
        selectedIds,
      );
      onUpdated(updated);
      toast({ title: "已更新关联班级", description: `共 ${selectedIds.length} 个班级` });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedSet = new Set(selectedIds);

  return (
    <Dialog open={open} onOpenChange={(next) => (!saving ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">关联班级</DialogTitle>
          <DialogDescription>
            从学生管理的班级列表中选择选学本课程的班级，关联到对应学期。
          </DialogDescription>
        </DialogHeader>

        {semesters.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
            <Users className="size-5" />
            还没有学期，请先在顶部「新建学期」，再来关联班级。
          </div>
        ) : (
          <div className="space-y-4">
            {semesters.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">关联到学期</Label>
                <Select value={semesterId} onValueChange={setSemesterId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="选择学期" />
                  </SelectTrigger>
                  <SelectContent>
                    {semesters.map((semester) => (
                      <SelectItem key={semester.id} value={semester.id}>
                        {semester.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">选择班级</Label>
                {selectedIds.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedIds.length} 个
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
                    暂无可选班级，请先到学生管理中创建班级。
                  </div>
                ) : (
                  <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">
                    {classes.map((item) => {
                      const selected = selectedSet.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggle(item.id)}
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
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || semesters.length === 0 || !semesterId}
          >
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
