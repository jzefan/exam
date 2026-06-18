import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  getCourseGradeWeights,
  updateCourseGradeWeights,
  type CourseGradeWeights,
} from "./api";

type WeightKey = keyof CourseGradeWeights;

const WEIGHT_ITEMS: { key: WeightKey; label: string; hint: string }[] = [
  { key: "chapter_task", label: "章节任务点", hint: "按完成视频、音频等任务点的个数计分，全部完成得满分" },
  { key: "chapter_quiz", label: "章节测验", hint: "按所有章节测验类型任务点的平均分计分" },
  { key: "assignment", label: "作业", hint: "按在线作业的平均分计分，所有作业按百分制分数计算" },
  { key: "exam", label: "考试", hint: "按在线考试的平均分计分，所有考试按百分制分数计算" },
];

const EMPTY: CourseGradeWeights = { chapter_task: 0, chapter_quiz: 0, assignment: 0, exam: 0 };

export function GradeWeightPanel({
  courseId,
  canWrite,
}: {
  courseId: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [weights, setWeights] = useState<CourseGradeWeights>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getCourseGradeWeights(courseId)
      .then((data) => setWeights({ ...EMPTY, ...data }))
      .catch(() => setWeights(EMPTY))
      .finally(() => setLoading(false));
  }, [courseId]);

  const total = useMemo(
    () => WEIGHT_ITEMS.reduce((sum, item) => sum + (Number(weights[item.key]) || 0), 0),
    [weights],
  );

  const setWeight = (key: WeightKey, value: number) =>
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await updateCourseGradeWeights(courseId, weights);
      setWeights({ ...EMPTY, ...saved });
      toast({ title: "成绩权重已保存" });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> 加载中...
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
          total === 100
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
      >
        <CheckCircle2 size={15} />
        总权重需 100%，当前总和{" "}
        <span className="font-semibold tabular-nums">{total}%</span>
      </div>

      <div className="space-y-4">
        {WEIGHT_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start gap-4">
            <span className="mt-1.5 w-24 shrink-0 text-sm font-medium text-foreground">
              {item.label}
            </span>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                value={weights[item.key]}
                disabled={!canWrite}
                onChange={(e) => setWeight(item.key, parseInt(e.target.value, 10) || 0)}
                className="h-9 w-20 text-sm tabular-nums"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="mt-1.5 flex-1 text-xs leading-5 text-muted-foreground">{item.hint}</p>
          </div>
        ))}
      </div>

      {canWrite ? (
        <div className="flex items-center gap-3 border-t border-border/60 pt-4">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            保存
          </Button>
          {total !== 100 ? (
            <span className="text-xs text-amber-600">提示：总权重建议为 100%</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
