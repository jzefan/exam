import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import { listCourseSemesters } from "@/pages/courses/api";
import { CopyTeachingProfileButton } from "@/pages/courses/teaching-profile-copy";
import {
  teachingProfileHasContent,
  type TeachingProfile,
  type TeachingProfileSource,
} from "@/pages/courses/teaching-profile";
import { createCourseTemplate, getTemplate, kbStats, updateTemplate, type KbStats } from "./api";
import { SeedStep, type BankSeed } from "./seed-step";
import type { ManualSeed, StudentProfile } from "./types";

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

const STEPS = [
  { id: 1, title: "技能信息", hint: "给这套命题经验起个名字" },
  { id: 2, title: "教学目标", hint: "给谁出题、希望达到什么能力" },
  { id: 3, title: "种子题", hint: "（可选）让 AI 模仿你的命题风格" },
];

function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? "" : opt.value)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function TemplateEditor({
  courseId,
  templateId,
  onSaved,
  onCancel,
}: {
  courseId: string;
  templateId: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(templateId);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [kb, setKb] = useState<KbStats | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  // Step 2
  const [teachingStage, setTeachingStage] = useState("");
  const [difficultyPref, setDifficultyPref] = useState("");
  const [teachingGoal, setTeachingGoal] = useState("");
  const [note, setNote] = useState("");

  // Step 3 — seeds
  const [manualSeeds, setManualSeeds] = useState<ManualSeed[]>([]);
  const [bankSeeds, setBankSeeds] = useState<BankSeed[]>([]);

  // 可从中复制教学画像的学期（仅保留填写了画像的）。
  const [semesterSources, setSemesterSources] = useState<TeachingProfileSource[]>([]);

  useEffect(() => {
    kbStats(courseId)
      .then(setKb)
      .catch(() => setKb(null));
  }, [courseId]);

  useEffect(() => {
    listCourseSemesters(courseId)
      .then((semesters) =>
        setSemesterSources(
          semesters
            .filter((s) => teachingProfileHasContent(s.student_profile))
            .map((s) => ({ id: s.id, name: s.name, profile: s.student_profile as TeachingProfile })),
        ),
      )
      .catch(() => setSemesterSources([]));
  }, [courseId]);

  const applyProfile = useCallback(
    (profile: TeachingProfile, sourceName: string) => {
      setTeachingStage(profile.teaching_stage ?? "");
      setDifficultyPref(profile.difficulty_preference ?? "");
      setTeachingGoal(profile.teaching_goal ?? "");
      setNote(profile.note ?? "");
      toast({ title: "已复制教学画像", description: `来自学期《${sourceName}》` });
    },
    [toast],
  );

  useEffect(() => {
    if (!templateId) return;
    setLoading(true);
    getTemplate(templateId)
      .then(async (tpl) => {
        setName(tpl.name);
        setDescription(tpl.description ?? "");
        setIsDefault(tpl.is_default);
        const profile = (tpl.student_profile ?? {}) as StudentProfile;
        setTeachingStage(profile.teaching_stage ?? "");
        setDifficultyPref(profile.difficulty_preference ?? "");
        setTeachingGoal(profile.teaching_goal ?? "");
        setNote(profile.note ?? "");
        setManualSeeds(tpl.manual_seed_questions ?? []);
        const ids = tpl.seed_question_ids ?? [];
        const seeds = await Promise.all(
          ids.map(async (qid) => {
            try {
              const question = await apiRequest<{ id: string; title: string; type: string }>(`/questions/${qid}`);
              return { id: qid, title: question.title || "题库题目", type: question.type };
            } catch {
              return { id: qid, title: "题库题目（已删除或不可见）", type: null };
            }
          }),
        );
        setBankSeeds(seeds);
      })
      .catch((error) => toast({ title: "加载出题技能失败", description: String(error), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [templateId, toast]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setStep(1);
      toast({ title: "请填写技能名称", variant: "destructive" });
      return;
    }
    setSaving(true);
    const profile: StudentProfile = {
      teaching_stage: teachingStage || null,
      difficulty_preference: difficultyPref || null,
      teaching_goal: teachingGoal.trim() || null,
      note: note.trim() || null,
    };
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      is_default: isDefault,
      student_profile: profile,
      seed_question_ids: bankSeeds.map((s) => s.id),
      manual_seed_questions: manualSeeds,
    };
    try {
      if (templateId) {
        await updateTemplate(templateId, payload);
      } else {
        await createCourseTemplate(courseId, { ...payload, course_kp_id: courseId });
      }
      toast({ title: isEdit ? "出题技能已更新" : "出题技能已创建", description: `《${name.trim()}》` });
      onSaved();
    } catch (error) {
      toast({ title: "保存失败", description: String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [
    name,
    description,
    isDefault,
    teachingStage,
    difficultyPref,
    teachingGoal,
    note,
    bankSeeds,
    manualSeeds,
    templateId,
    courseId,
    isEdit,
    onSaved,
    toast,
  ]);

  const goNext = () => {
    if (step === 1 && !name.trim()) {
      toast({ title: "请先填写技能名称", variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" size={18} /> 加载出题技能...
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* Step indicator */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, index) => (
            <div key={s.id} className="flex flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => (s.id < step || isEdit ? setStep(s.id) : undefined)}
                className={cn(
                  "flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  step === s.id
                    ? "border-primary bg-primary/5"
                    : s.id < step || isEdit
                      ? "border-border hover:border-primary/40 cursor-pointer"
                      : "border-border/60 opacity-60",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px]",
                      step > s.id
                        ? "bg-primary text-primary-foreground"
                        : step === s.id
                          ? "border border-primary text-primary"
                          : "border border-border text-muted-foreground",
                    )}
                  >
                    {step > s.id ? <Check size={12} /> : s.id}
                  </span>
                  {s.title}
                </span>
                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
              </button>
              {index < STEPS.length - 1 && <div className="h-px w-3 shrink-0 bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 1: 基本信息 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                出题技能是你为这门课沉淀的一套命题经验。出题时 AI 会
                <span className="text-foreground">自动基于整门课程的知识库</span>
                （当前已入库{" "}
                <span className="font-medium text-primary">{kb?.chunk_count ?? 0}</span> 个资料片段），
                无需选择资料或知识点。
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-name">技能名称</Label>
              <Input
                id="skill-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：期末复习出题、平时随堂练习"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-desc">说明（可选）</Label>
              <Input
                id="skill-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="备注这套技能的适用场景"
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} id="skill-default" />
              <div>
                <Label htmlFor="skill-default" className="cursor-pointer">
                  设为本课程默认技能
                </Label>
                <p className="text-xs text-muted-foreground">出题时优先选中该技能。</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: 教学对象与目标 */}
        {step === 2 && (
          <div className="space-y-5">
            {semesterSources.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                <p className="text-xs text-muted-foreground">已在学期里填过教学画像？可一键复制过来。</p>
                <CopyTeachingProfileButton sources={semesterSources} label="从学期复制" onCopy={applyProfile} />
              </div>
            )}
            <div className="space-y-2">
              <Label>教学阶段</Label>
              <ChipGroup options={STAGE_OPTIONS} value={teachingStage} onChange={setTeachingStage} />
            </div>
            <div className="space-y-2">
              <Label>难度偏好</Label>
              <ChipGroup options={DIFFICULTY_OPTIONS} value={difficultyPref} onChange={setDifficultyPref} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-goal" className="flex items-center gap-1.5">
                <Target size={14} className="text-primary" />
                教学目标
              </Label>
              <Textarea
                id="skill-goal"
                value={teachingGoal}
                onChange={(e) => setTeachingGoal(e.target.value)}
                rows={3}
                placeholder="希望学生达到什么能力？如：能独立编写包含分支与循环的 Python 程序，并能阅读和调试他人代码。"
              />
              <p className="text-xs text-muted-foreground">AI 会围绕教学目标考查相应能力，写得越具体，出题越准。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-note">补充说明（可选）</Label>
              <Textarea
                id="skill-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="如：学生数学基础一般，题目避免复杂推导。"
              />
            </div>
          </div>
        )}

        {/* Step 3: 种子题 */}
        {step === 3 && (
          <SeedStep
            courseId={courseId}
            bankSeeds={bankSeeds}
            setBankSeeds={setBankSeeds}
            manualSeeds={manualSeeds}
            setManualSeeds={setManualSeeds}
          />
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={14} className="mr-1" />
                上一步
              </Button>
            )}
            {step < 3 ? (
              <Button onClick={goNext}>
                下一步
                <ArrowRight size={14} className="ml-1" />
              </Button>
            ) : (
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />}
                {isEdit ? "保存修改" : "完成创建"}
              </Button>
            )}
            {isEdit && step < 3 && (
              <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                保存修改
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
