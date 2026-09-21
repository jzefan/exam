import { useEffect, useState } from "react";
import { Check, Loader2, Target, Users } from "lucide-react";

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
import { listCourseTemplates } from "@/pages/courses/question-gen-templates/api";

import { createCourseSemester, type CourseSemester } from "./api";
import { CopyTeachingProfileButton } from "./teaching-profile-copy";
import {
  teachingProfileHasContent,
  type TeachingProfile,
  type TeachingProfileSource,
} from "./teaching-profile";

const STAGE_OPTIONS = [
  { value: "college", label: "大专" },
  { value: "undergraduate", label: "本科" },
  { value: "postgraduate", label: "研究生" },
  { value: "any", label: "不限" },
];
const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "简单" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "偏难" },
];

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
  // 教学对象画像（可选）—— 用于预填该学期的出题技能；字段与"出题技能 · 第2步 教学目标"保持一致。
  const [teachingStage, setTeachingStage] = useState("");
  const [difficultyPref, setDifficultyPref] = useState("");
  const [teachingGoal, setTeachingGoal] = useState("");
  const [profileNote, setProfileNote] = useState("");
  // 可从中复制教学画像的出题技能（仅保留填写了画像的）。
  const [skillSources, setSkillSources] = useState<TeachingProfileSource[]>([]);

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
      listCourseTemplates(courseId)
        .then((skills) =>
          setSkillSources(
            skills
              .filter((s) => teachingProfileHasContent(s.student_profile))
              .map((s) => ({ id: s.id, name: s.name, profile: s.student_profile as TeachingProfile })),
          ),
        )
        .catch(() => setSkillSources([]));
    } else {
      setName("");
      setSemesterMajorLabel("");
      setSemesterMajorDescription("");
      setDescription("");
      setSelectedClassIds([]);
      setSubmitting(false);
      setTeachingStage("");
      setDifficultyPref("");
      setTeachingGoal("");
      setProfileNote("");
      setSkillSources([]);
    }
  }, [open, courseId, toast]);

  const applyProfile = (profile: TeachingProfile, sourceName: string) => {
    setTeachingStage(profile.teaching_stage ?? "");
    setDifficultyPref(profile.difficulty_preference ?? "");
    setTeachingGoal(profile.teaching_goal ?? "");
    setProfileNote(profile.note ?? "");
    toast({ title: "已复制教学画像", description: `来自出题技能《${sourceName}》` });
  };

  const buildStudentProfile = (): Record<string, unknown> | null => {
    const profile: Record<string, unknown> = {};
    if (teachingStage) profile.teaching_stage = teachingStage;
    if (difficultyPref) profile.difficulty_preference = difficultyPref;
    if (teachingGoal.trim()) profile.teaching_goal = teachingGoal.trim();
    if (profileNote.trim()) profile.note = profileNote.trim();
    return Object.keys(profile).length ? profile : null;
  };

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
        student_profile: buildStudentProfile(),
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
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="font-serif text-lg">新建学期</DialogTitle>
          <DialogDescription className="sr-only">
            填写学期信息并创建学期。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div
            data-testid="new-semester-fields"
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
          >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-semester-name" className="flex items-center gap-1">
                  学期名称
                  <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="new-semester-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="如：2026 春季"
                  autoFocus
                  required
                  maxLength={100}
                />
              </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>关联班级</Label>
                {selectedClassIds.length > 0 ? (
                  <span className="text-xs text-muted-foreground">已选 {selectedClassIds.length} 个</span>
                ) : null}
              </div>
                <div className="rounded-lg border border-border bg-muted/20 p-2">
                  {loadingClasses ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      正在加载班级...
                    </div>
                  ) : classes.length === 0 ? (
                    <div className="flex items-start gap-2 px-2 py-3 text-sm text-muted-foreground">
                      <Users className="mt-0.5 size-4 shrink-0" />
                      暂无可选班级，可稍后在学生管理中创建并关联。
                    </div>
                  ) : (
                    <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                      {classes.map((item) => {
                        const selected = selectedClassSet.has(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleClass(item.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="new-semester-major-label">专业标签</Label>
                <p className="text-right text-xs text-muted-foreground">用于区分本学期教学对象。</p>
              </div>
              <Input
                id="new-semester-major-label"
                value={semesterMajorLabel}
                onChange={(event) => setSemesterMajorLabel(event.target.value)}
                placeholder="如：A 专业"
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-semester-major-label-desc">专业描述</Label>
              <Textarea
                id="new-semester-major-label-desc"
                value={semesterMajorDescription}
                onChange={(event) => setSemesterMajorDescription(event.target.value)}
                placeholder="补充专业或培养方向说明"
                rows={2}
                maxLength={2000}
              />
            </div>

              <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Label className="shrink-0 text-sm">教学对象画像</Label>
                  <div className="flex items-center justify-end gap-2">
                    <CopyTeachingProfileButton sources={skillSources} label="从出题技能复制" onCopy={applyProfile} />
                    <p className="text-right text-xs text-muted-foreground">
                      用于预填本学期的出题技能，可跳过。
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">教学阶段</Label>
                  <div className="flex flex-wrap gap-2">
                    {STAGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={teachingStage === opt.value}
                        onClick={() => setTeachingStage((value) => (value === opt.value ? "" : opt.value))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          teachingStage === opt.value
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">难度偏好</Label>
                  <div className="flex flex-wrap gap-2">
                    {DIFFICULTY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={difficultyPref === opt.value}
                        onClick={() => setDifficultyPref((value) => (value === opt.value ? "" : opt.value))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          difficultyPref === opt.value
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="semester-teaching-goal" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Target size={14} className="text-primary" />
                    教学目标
                  </Label>
                  <Textarea
                    id="semester-teaching-goal"
                    value={teachingGoal}
                    onChange={(event) => setTeachingGoal(event.target.value)}
                    rows={3}
                    placeholder="如：能独立编写包含分支与循环的 Python 程序。"
                    maxLength={2000}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="semester-profile-note" className="text-xs text-muted-foreground">
                    补充说明
                  </Label>
                  <Textarea
                    id="semester-profile-note"
                    value={profileNote}
                    onChange={(event) => setProfileNote(event.target.value)}
                    placeholder="如：学生数学基础一般，避免复杂推导。"
                    rows={2}
                    maxLength={2000}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-semester-desc">备注</Label>
                <Textarea
                  id="new-semester-desc"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="如：面向 25 级软工 1–3 班"
                  rows={4}
                  maxLength={2000}
                />
              </div>
          </div>
          <DialogFooter className="border-t border-border/60 bg-background px-6 py-4">
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
