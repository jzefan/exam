import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useList } from "@refinedev/core";
import { ListPlus, Loader2 } from "lucide-react";

import {
  getQuestionDisplayType,
  questionDisplayTypeFullLabel,
} from "@/components/questions/question-preview-utils";
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
import { useToast } from "@/hooks/use-toast";
import type { IPaper, IPaperDetail, IQuestion, IQuestionBank } from "@/types";

import { paperApiRequest } from "./api";
import { allocateExpansionQuestionIds } from "./paper-expand-utils";

interface PaperExpandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paper: IPaper;
  courseQuestionBankName?: string;
  /** 生成后跳转到新试卷详情时携带的导航状态。 */
  generatedPaperState?: unknown;
}

/**
 * 以当前试卷为底稿，保留题目和知识点，从课程题库扩充题目后生成一份新试卷。
 */
export function PaperExpandDialog({
  open,
  onOpenChange,
  paper,
  courseQuestionBankName,
  generatedPaperState,
}: PaperExpandDialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [detail, setDetail] = useState<IPaperDetail | null>(null);
  const [bankQuestions, setBankQuestions] = useState<IQuestion[]>([]);
  const [target, setTarget] = useState(100);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];
  const bank = courseQuestionBankName
    ? (banks.find((item) => item.name === courseQuestionBankName) ?? null)
    : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setBankQuestions([]);
    const params = new URLSearchParams({
      _start: "0",
      _end: "2000",
      ...(bank ? { question_bank_id: bank.id } : {}),
    });
    Promise.all([
      paperApiRequest<IPaperDetail>(`/papers/${paper.id}`),
      bank
        ? paperApiRequest<IQuestion[]>(`/questions?${params}`)
        : Promise.resolve<IQuestion[]>([]),
    ])
      .then(([paperDetail, questions]) => {
        if (cancelled) return;
        setDetail(paperDetail);
        setBankQuestions(questions);
        setTarget(Math.max(100, paperDetail.questions.length));
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "加载试卷失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
          });
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, paper.id, bank?.id, onOpenChange, toast]);

  const paperQuestions = detail?.questions ?? [];
  const paperKnowledgeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of paperQuestions) {
      for (const point of item.question?.knowledge_points ?? []) {
        ids.add(point.id);
      }
    }
    if (ids.size === 0 && paper.root_knowledge_point_id) {
      ids.add(paper.root_knowledge_point_id);
    }
    return ids;
  }, [paperQuestions, paper.root_knowledge_point_id]);

  const expandCandidates = useMemo(() => {
    const selected = new Set(paperQuestions.map((item) => item.question_id));
    return bankQuestions.filter(
      (question) =>
        !selected.has(question.id) &&
        (paperKnowledgeIds.size === 0 ||
          question.knowledge_points.some((point) =>
            paperKnowledgeIds.has(point.id),
          )),
    );
  }, [bankQuestions, paperKnowledgeIds, paperQuestions]);

  const bankTypeRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of bankQuestions) {
      const displayType = getQuestionDisplayType(question);
      if (!displayType) continue;
      counts.set(displayType, (counts.get(displayType) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      ([a], [b]) =>
        Object.keys(questionDisplayTypeFullLabel).indexOf(a) -
        Object.keys(questionDisplayTypeFullLabel).indexOf(b),
    );
  }, [bankQuestions]);

  const addedIds = useMemo(
    () =>
      allocateExpansionQuestionIds(
        paperQuestions.map((item) =>
          item.question ? getQuestionDisplayType(item.question) : null,
        ),
        expandCandidates.map((question) => ({
          id: question.id,
          displayType: getQuestionDisplayType(question),
        })),
        target,
      ),
    [expandCandidates, paperQuestions, target],
  );

  const handleGenerate = async () => {
    if (addedIds.length === 0) return;
    setCreating(true);
    try {
      const created = await paperApiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title: `${paper.title} - 扩充版`,
          description: null,
          source_type: "manual",
          root_knowledge_point_id: paper.root_knowledge_point_id,
          question_items: [
            ...paperQuestions.map((item, index) => ({
              question_id: item.question_id,
              order: index,
              score_override: item.score_override,
            })),
            ...addedIds.map((questionId, index) => ({
              question_id: questionId,
              order: paperQuestions.length + index,
              score_override: null,
            })),
          ],
        }),
      });
      toast({
        title: "已生成扩充试卷",
        description: `共 ${created.questions.length} 道题`,
      });
      onOpenChange(false);
      navigate(`/papers/${created.id}`, { state: generatedPaperState });
    } catch (error) {
      toast({
        title: "生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus size={16} />
            扩充生成试卷
          </DialogTitle>
          <DialogDescription>
            以「{paper.title}」为底稿，保留现有题目和知识点，扩充题目后生成一份新试卷。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载试卷与题库...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="paper-expand-target">目标题数</Label>
              <Input
                id="paper-expand-target"
                type="number"
                min={paperQuestions.length}
                value={target}
                onChange={(event) => setTarget(Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                当前试卷 {paperQuestions.length} 题，将补充 {addedIds.length} 题
                {addedIds.length <
                Math.max(0, Math.floor(target) - paperQuestions.length)
                  ? "（同知识点可用题目不足）"
                  : ""}
                ，生成后共 {paperQuestions.length + addedIds.length} 题。
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <p className="text-sm font-medium text-foreground">
                课程题库共 {bankQuestions.length} 题
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {bankTypeRows.map(([type, count]) => (
                  <span key={type}>
                    {questionDisplayTypeFullLabel[
                      type as keyof typeof questionDisplayTypeFullLabel
                    ] ?? type}{" "}
                    {count}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                同知识点且未在试卷中的可用 {expandCandidates.length} 题
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={loading || creating || addedIds.length === 0}
            onClick={() => void handleGenerate()}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            生成试卷
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
