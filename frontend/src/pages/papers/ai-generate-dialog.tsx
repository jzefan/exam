import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import {
  generatePaperFromSource,
  getDifficultyStrategyLabel,
  PAPER_SOURCE_REUSE_RATE_OPTIONS,
  type PaperDifficultyStrategy,
} from "./api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DIFFICULTY_OPTIONS: PaperDifficultyStrategy[] = ["similar", "easier", "harder"];

interface PaperAIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paperId: string;
  paperTitle: string;
  rootKnowledgePointName?: string | null;
  generatedPaperState?: unknown;
}

export function PaperAIGenerateDialog({
  open,
  onOpenChange,
  paperId,
  paperTitle,
  rootKnowledgePointName,
  generatedPaperState,
}: PaperAIGenerateDialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [difficultyStrategy, setDifficultyStrategy] = useState<PaperDifficultyStrategy>("similar");
  const [preferRootKnowledgePoint, setPreferRootKnowledgePoint] = useState(true);
  const [sourceReuseRate, setSourceReuseRate] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const hasRootKnowledgePoint = Boolean(rootKnowledgePointName);

  useEffect(() => {
    if (!open) return;
    setDifficultyStrategy("similar");
    setPreferRootKnowledgePoint(hasRootKnowledgePoint);
    setSourceReuseRate(0);
  }, [open, hasRootKnowledgePoint, paperId]);

  const handleGenerate = async () => {
    setSubmitting(true);
    try {
      const result = await generatePaperFromSource(paperId, {
        count: 1,
        difficulty_strategy: difficultyStrategy,
        question_type_strategy: "inherit",
        prefer_root_knowledge_point: hasRootKnowledgePoint ? preferRootKnowledgePoint : false,
        source_reuse_rate: sourceReuseRate,
      });
      toast({
        title: "生成成功",
        description: `已生成 ${result.generated_question_count} 道题目`,
      });
      onOpenChange(false);
      navigate(`/papers/${result.paper_id}`, { state: generatedPaperState });
    } catch (error) {
      toast({
        title: "生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI 生成新试卷
          </DialogTitle>
          <DialogDescription>{paperTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <Label>难度策略</Label>
            <div className="inline-flex w-full rounded-md border border-border p-1">
              {DIFFICULTY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={submitting}
                  onClick={() => setDifficultyStrategy(option)}
                  className={`h-9 flex-1 rounded text-sm ${
                    difficultyStrategy === option
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {getDifficultyStrategyLabel(option)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>题型配比</Label>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">继承原卷</div>
          </div>

          <div className="space-y-2">
            <Label>题目重复率</Label>
            <div className="flex w-full items-center gap-2">
              <div className="inline-flex flex-1 rounded-md border border-border p-1">
                {PAPER_SOURCE_REUSE_RATE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={submitting}
                    onClick={() => setSourceReuseRate(option)}
                    className={`h-9 flex-1 rounded text-sm ${
                      sourceReuseRate === option
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option === 0 ? "不重复" : `≤ ${option}%`}
                  </button>
                ))}
              </div>
              <div className="relative shrink-0">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={sourceReuseRate}
                  disabled={submitting}
                  aria-label="自定义题目重复率"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSourceReuseRate(Number.isFinite(next) ? Math.min(100, Math.max(0, next)) : 0);
                  }}
                  className="h-9 w-28 pr-8"
                  placeholder="自定义"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              新试卷中最多复用源试卷题目的占比，其余由 AI 生成。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">优先主知识点</p>
                <p className="text-xs text-muted-foreground">
                  {hasRootKnowledgePoint ? rootKnowledgePointName : "源试卷未配置主知识点"}
                </p>
              </div>
              <Switch
                checked={hasRootKnowledgePoint ? preferRootKnowledgePoint : false}
                onCheckedChange={setPreferRootKnowledgePoint}
                disabled={!hasRootKnowledgePoint || submitting}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleGenerate} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            生成新试卷
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
