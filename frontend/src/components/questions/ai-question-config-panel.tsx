import type { ReactNode } from "react";
import { Bot } from "lucide-react";

import { Input } from "@/components/ui/input";
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

type AIQuestionConfigPanelProps = {
  title: string;
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
  footer?: ReactNode;
};

export function AIQuestionConfigPanel({
  title,
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
  footer,
}: AIQuestionConfigPanelProps) {
  return (
    <aside className={cn("space-y-5 rounded-xl border border-border/80 bg-card p-5", className)}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>

      <div className="space-y-1.5">
        <Label>题目总数</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={totalCount}
          onChange={(e) => onTotalCountChange(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
      </div>

      <div className="space-y-1.5">
        <Label>难度</Label>
        <Select value={String(difficulty)} onValueChange={(value) => onDifficultyChange(Number(value))}>
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

      <div className="space-y-2">
        <Label>题型分配</Label>
        {allocationError ? (
          <p className="text-xs text-destructive">{allocationError}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {(Object.keys(AI_TYPE_LABELS) as QuestionType[]).map((type) => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-16 text-xs text-muted-foreground">{AI_TYPE_LABELS[type]}</span>
              <Input
                type="number"
                min={0}
                max={50}
                className="h-8 w-16"
                value={typeAlloc[type]}
                onChange={(e) =>
                  onTypeAllocChange({
                    ...typeAlloc,
                    [type]: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5"><Bot size={14} />AI 模型</Label>
        <Select value={model} onValueChange={(value) => onModelChange(value as AIModelProvider)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_MODEL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
                <span className="ml-2 text-xs text-muted-foreground">{option.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <KnowledgePointSelector
        fetcher={fetcher}
        selectedKnowledgePoints={selectedKnowledgePoints}
        onSelectedKnowledgePointsChange={onSelectedKnowledgePointsChange}
        storageKey={storageKey}
      />

      <div className="space-y-1.5">
        <Label>自定义提示</Label>
        <Textarea
          placeholder="对生成题目的额外要求..."
          rows={3}
          value={customPrompt}
          onChange={(e) => onCustomPromptChange(e.target.value)}
        />
      </div>

      {footer}
    </aside>
  );
}
