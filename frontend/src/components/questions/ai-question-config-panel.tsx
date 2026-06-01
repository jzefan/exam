import { useEffect, type ReactNode } from "react";
import { Bot, Minus, Plus, RotateCcw, Sparkles } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionType } from "@/types";
import {
  AI_DIFFICULTY_LABELS,
  AI_MODEL_OPTIONS,
  type AIModelProvider,
  AI_TYPE_LABELS,
} from "./ai-question-config-constants";
import {
  KnowledgePointSelector,
  type KnowledgePointSelectorFetcher,
  type SelectedKnowledgePoint,
} from "./knowledge-point-selector";
import { cn } from "@/lib/utils";

export type AIQuestionConfigFetcher = KnowledgePointSelectorFetcher;
export type { SelectedKnowledgePoint } from "./knowledge-point-selector";

const CUSTOM_PROMPT_MAX = 200;

type AIQuestionConfigPanelProps = {
  title: string;
  /** Optional one-line caption shown under the title. */
  subtitle?: string;
  fetcher: AIQuestionConfigFetcher;
  storageKey?: string;
  className?: string;
  totalCount: number;
  onTotalCountChange: (value: number) => void;
  difficulty: number;
  onDifficultyChange: (value: number) => void;
  typeAlloc: Record<QuestionType, number>;
  onTypeAllocChange: (value: Record<QuestionType, number>) => void;
  model: AIModelProvider;
  onModelChange: (value: AIModelProvider) => void;
  selectedKnowledgePoints: SelectedKnowledgePoint[];
  onSelectedKnowledgePointsChange: (value: SelectedKnowledgePoint[]) => void;
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  allocationError?: string | null;
  /** When provided, a 重置 button is rendered in the header. */
  onReset?: () => void;
  footer?: ReactNode;
  /**
   * When provided, the knowledge-point selector is replaced by a read-only
   * list of locked paths. Use this in flows where the knowledge point is
   * implied by context (e.g. generating from a learning material attached
   * to a specific node).
   */
  lockedKnowledgePointPaths?: string[];
  filterRootNodeId?: string;
};

/** Pill-shaped number stepper for one question type. */
function TypeStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.max(0, Math.min(99, next)));
  const active = value > 0;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 transition-colors",
        active ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30",
      )}
    >
      <span
        className={cn(
          "text-xs font-medium",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`减少${label}`}
          disabled={value === 0}
          onClick={() => set(value - 1)}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
        >
          <Minus size={13} />
        </button>
        <input
          aria-label={`${label}数量`}
          inputMode="numeric"
          value={value}
          onChange={(e) =>
            set(parseInt(e.target.value.replace(/\D/g, "") || "0", 10))
          }
          className={cn(
            "w-8 border-none bg-transparent text-center text-sm font-bold tabular-nums outline-none",
            active ? "text-primary" : "text-foreground",
          )}
        />
        <button
          type="button"
          aria-label={`增加${label}`}
          onClick={() => set(value + 1)}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

export function AIQuestionConfigPanel({
  title,
  subtitle,
  fetcher,
  storageKey = "ai-question-config-panel-recent-keywords",
  className,
  totalCount,
  onTotalCountChange,
  difficulty,
  onDifficultyChange,
  typeAlloc,
  onTypeAllocChange,
  model,
  onModelChange,
  selectedKnowledgePoints,
  onSelectedKnowledgePointsChange,
  customPrompt,
  onCustomPromptChange,
  allocationError,
  onReset,
  footer,
  lockedKnowledgePointPaths,
  filterRootNodeId,
}: AIQuestionConfigPanelProps) {
  const allocatedTotal = (Object.values(typeAlloc) as number[]).reduce(
    (sum, value) => sum + value,
    0,
  );

  // 题型分配即题目来源：总数由各题型数量之和自动得出，并同步给父级（不再单独输入总数）。
  useEffect(() => {
    if (totalCount !== allocatedTotal) onTotalCountChange(allocatedTotal);
  }, [allocatedTotal, totalCount, onTotalCountChange]);

  const handleTypeChange = (type: QuestionType, raw: number) =>
    onTypeAllocChange({ ...typeAlloc, [type]: Math.max(0, raw) });

  return (
    <aside
      className={cn(
        "space-y-2 rounded-xl border border-border/80 bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw size={13} />
            重置
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>题型分配</Label>
          <span className="text-xs text-muted-foreground">
            共{" "}
            <span className="font-semibold text-primary">{allocatedTotal}</span>{" "}
            题
          </span>
        </div>
        {allocationError ? (
          <p className="text-xs text-destructive">{allocationError}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(AI_TYPE_LABELS) as QuestionType[]).map((type) => (
            <TypeStepper
              key={type}
              label={AI_TYPE_LABELS[type]}
              value={typeAlloc[type] || 0}
              onChange={(value) => handleTypeChange(type, value)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>难度</Label>
          <Select
            value={String(difficulty)}
            onValueChange={(value) => onDifficultyChange(Number(value))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {AI_DIFFICULTY_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Bot size={14} />
            AI 模型
          </Label>
          <Select
            value={model}
            onValueChange={(value) => onModelChange(value as AIModelProvider)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {option.desc}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {lockedKnowledgePointPaths !== undefined ? (
        <div className="space-y-1.5">
          <Label>知识点（已锁定）</Label>
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
            {lockedKnowledgePointPaths.length === 0 ? (
              <p className="text-xs text-muted-foreground">未提供知识点路径</p>
            ) : (
              lockedKnowledgePointPaths.map((path, index) => (
                <p
                  key={`${path}-${index}`}
                  className="break-words text-xs leading-snug text-foreground"
                >
                  {path}
                </p>
              ))
            )}
          </div>
        </div>
      ) : (
        <KnowledgePointSelector
          fetcher={fetcher}
          selectedKnowledgePoints={selectedKnowledgePoints}
          onSelectedKnowledgePointsChange={onSelectedKnowledgePointsChange}
          storageKey={storageKey}
          selectionTarget="any"
          filterRootNodeId={filterRootNodeId}
        />
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>自定义提示</Label>
          <span className="text-[11px] text-muted-foreground">
            {customPrompt.length}/{CUSTOM_PROMPT_MAX}
          </span>
        </div>
        <Textarea
          placeholder="对生成题目的额外要求，例如：结合实际工程案例、避免纯记忆题…"
          rows={3}
          maxLength={CUSTOM_PROMPT_MAX}
          value={customPrompt}
          onChange={(e) => onCustomPromptChange(e.target.value)}
        />
      </div>

      {footer}
    </aside>
  );
}
