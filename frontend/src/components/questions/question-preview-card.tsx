import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Clock3, GraduationCap, Loader2, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IQuestion } from "@/types";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { LatexText } from "@/components/ui/latex-text";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RichContent } from "@/components/ui/rich-content";
import {
  getQuestionAnswerText,
  getQuestionContentHtml,
  getQuestionTitle,
  isMultiChoice,
  normalizeQuestionType,
  questionDifficultyConfig,
  questionTypeChar,
  questionTypeColorClass,
} from "./question-preview-utils";
import type { QuestionKnowledgeRecognitionStatus } from "@/pages/questions/question-knowledge-recognition";

const knowledgeRecognitionConfig: Record<
  QuestionKnowledgeRecognitionStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  waiting: {
    label: "等待 AI 识别",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
    icon: Clock3,
  },
  running: {
    label: "AI 识别中",
    className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
    icon: Loader2,
  },
};

function RenderTextWithCode({ text, language }: { text: string; language?: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  if (parts.length === 1) {
    return <LatexText>{text}</LatexText>;
  }

  return (
    <>
      {parts.map((part, index) => {
        const fenceMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
        if (fenceMatch) {
          const codeLanguage = fenceMatch[1] || language || "python";
          const code = fenceMatch[2].trim();
          return <CodeBlock key={index} code={code} language={codeLanguage} />;
        }
        return part ? <LatexText key={index}>{part}</LatexText> : null;
      })}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedLatexText(text: string, keyword?: string) {
  const normalizedKeyword = keyword?.trim();
  if (!normalizedKeyword) {
    return <LatexText>{text}</LatexText>;
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedKeyword)})`, "gi");
  const parts = text.split(matcher);
  return (
    <>
      {parts.map((part, index) => {
        if (!part) {
          return null;
        }
        if (part.toLowerCase() === normalizedKeyword.toLowerCase()) {
          return (
            <mark
              key={`${part}-${index}`}
              className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/25"
            >
              <LatexText>{part}</LatexText>
            </mark>
          );
        }
        return <LatexText key={`${part}-${index}`}>{part}</LatexText>;
      })}
    </>
  );
}

function renderCodeAnswer(question: IQuestion) {
  if (question.type !== "code") {
    return null;
  }

  const code = question.answer?.code as string | undefined;
  const language = (question.content?.language as string) || "python";
  return (
    <div className="mt-2">
      <p className="mb-1 text-sm text-muted-foreground">参考代码：</p>
      {code ? <CodeBlock code={code} language={language} /> : <p className="text-sm text-muted-foreground">无</p>}
    </div>
  );
}

type ChoiceOptionsLayout = "single-row" | "two-column" | "single-column";

function measureTextWidth(text: string, font: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return text.length * 14;
  }
  context.font = font;
  return context.measureText(text).width;
}

function ChoiceOptions({
  question,
  highlightKeyword,
}: {
  question: IQuestion;
  highlightKeyword?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<ChoiceOptionsLayout>("single-column");

  useEffect(() => {
    if (question.type !== "choice" || !question.options || !containerRef.current) {
      return;
    }

    const element = containerRef.current;
    const entries = Object.entries(question.options as Record<string, string>);

    const updateLayout = () => {
      const width = element.clientWidth;
      if (!width) {
        return;
      }

      const computedStyle = window.getComputedStyle(element);
      const font = computedStyle.font || `${computedStyle.fontSize} ${computedStyle.fontFamily}`;
      const gap = 24;
      const itemPadding = 16;
      const optionWidths = entries.map(([key, value]) =>
        measureTextWidth(`${key}. ${value}`, font) + itemPadding,
      );

      const totalInlineWidth =
        optionWidths.reduce((sum, current) => sum + current, 0) + gap * Math.max(entries.length - 1, 0);
      if (totalInlineWidth <= width) {
        setLayout("single-row");
        return;
      }

      const twoColumnWidth = (width - gap) / 2;
      const canUseTwoColumns = optionWidths.every((optionWidth) => optionWidth <= twoColumnWidth);
      setLayout(canUseTwoColumns ? "two-column" : "single-column");
    };

    updateLayout();

    const observer = new ResizeObserver(() => updateLayout());
    observer.observe(element);
    return () => observer.disconnect();
  }, [question.options, question.type]);

  if (question.type !== "choice" || !question.options) {
    return null;
  }

  const entries = Object.entries(question.options as Record<string, string>);
  const layoutClass =
    layout === "single-row"
      ? "flex flex-nowrap gap-x-6 gap-y-0.5 overflow-hidden"
      : layout === "two-column"
        ? "grid grid-cols-2 gap-x-6 gap-y-1.5"
        : "grid grid-cols-1 gap-y-1.5";

  return (
    <div ref={containerRef} className={cn("mt-2", layoutClass)}>
      {entries.map(([key, value]) => (
        <span
          key={key}
          className={cn(
            "text-sm text-muted-foreground",
            layout === "single-row" ? "min-w-0 whitespace-nowrap" : "min-w-0 break-words",
          )}
        >
          {key}. {renderHighlightedLatexText(value, highlightKeyword)}
        </span>
      ))}
    </div>
  );
}

export function QuestionPreviewCard({
  question,
  mode = "detailed",
  className,
  index,
  trailing,
  actions,
  expanded,
  defaultExpanded = false,
  hideTypeBadge = false,
  hideAnswer = false,
  highlightKeyword,
  expandOnHover = false,
  hoverDetailDelay = 180,
  knowledgeRecognitionStatus,
  ...props
}: {
  question: IQuestion;
  mode?: "detailed" | "compact";
  className?: string;
  index?: number;
  trailing?: ReactNode;
  actions?: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  hideTypeBadge?: boolean;
  hideAnswer?: boolean;
  highlightKeyword?: string;
  expandOnHover?: boolean;
  hoverDetailDelay?: number;
  knowledgeRecognitionStatus?: QuestionKnowledgeRecognitionStatus | null;
} & HTMLAttributes<HTMLDivElement>) {
  const [isHovered, setIsHovered] = useState(false);
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const diff = questionDifficultyConfig[question.difficulty] ?? {
    label: String(question.difficulty),
    variant: "outline" as const,
  };
  const answerText = getQuestionAnswerText(question);
  const isExpanded = expanded ?? defaultExpanded;
  const showDetails = expandOnHover ? isHoverExpanded : mode === "detailed" ? isExpanded : defaultExpanded;
  const html = getQuestionContentHtml(question);
  const hasInlineImages = Boolean(html && /<img\s/i.test(html));
  const normalizedType = normalizeQuestionType(question.type);
  const isInlineAnswerType =
    normalizedType === "choice" || normalizedType === "fill_in" || normalizedType === "true_false";
  const recognitionMeta = knowledgeRecognitionStatus ? knowledgeRecognitionConfig[knowledgeRecognitionStatus] : null;
  const RecognitionIcon = recognitionMeta?.icon;

  useEffect(() => {
    if (!expandOnHover) {
      return;
    }

    if (hoverExpandTimerRef.current) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }

    if (isHovered) {
      hoverExpandTimerRef.current = window.setTimeout(() => {
        setIsHoverExpanded(true);
      }, hoverDetailDelay);
    }

    return () => {
      if (hoverExpandTimerRef.current) {
        window.clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = null;
      }
    };
  }, [expandOnHover, hoverDetailDelay, isHovered]);

  return (
    <div
      className={cn("group relative rounded-lg border border-border bg-card p-3 sm:p-4", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsHoverExpanded(false);
      }}
      {...props}
    >
      {(trailing || !hideTypeBadge) && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          {!hideTypeBadge ? (
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold",
                normalizedType === "choice" && isMultiChoice(question)
                  ? "bg-cyan-500 text-white"
                  : normalizedType
                    ? questionTypeColorClass[normalizedType]
                    : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
              )}
            >
                  {normalizedType === "choice"
                    ? isMultiChoice(question)
                      ? "多"
                      : "单"
                    : normalizedType
                      ? questionTypeChar[normalizedType]
                      : "题"}
                </div>
              ) : null}
              {trailing}
            </div>
          )}

          <div className="flex gap-2">
            {typeof index === "number" ? (
              <div className="w-5 flex-shrink-0 pt-0.5 text-left text-sm font-bold text-muted-foreground">
                {index}.
              </div>
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="flex-1 space-y-2">
                {mode === "detailed" && (
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                    <span>{hasInlineImages ? "题干与图片" : "题干"}</span>
                  </div>
                )}
                {html ? (
                  <RichContent html={html} className="flex-1 text-sm leading-relaxed text-foreground" />
                ) : (
                  <p className="flex-1 text-sm leading-relaxed text-foreground">
                    {renderHighlightedLatexText(getQuestionTitle(question), highlightKeyword)}
                  </p>
                )}
              </div>

              <ChoiceOptions question={question} highlightKeyword={highlightKeyword} />
          {recognitionMeta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("gap-1.5 px-2 py-0.5", recognitionMeta.className)}>
                {RecognitionIcon ? (
                  <RecognitionIcon
                    size={12}
                    className={knowledgeRecognitionStatus === "running" ? "animate-spin" : undefined}
                  />
                ) : null}
                {recognitionMeta.label}
              </Badge>
            </div>
          ) : null}
          {!hideAnswer && answerText !== "" ? (
            <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              {isInlineAnswerType ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-emerald-900 dark:text-emerald-100">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700/80 dark:text-emerald-300/80">
                    答案
                  </span>
                  <LatexText>{answerText}</LatexText>
                </div>
              ) : (
                <>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700/80 dark:text-emerald-300/80">
                    {normalizedType === "short_answer" || normalizedType === "essay" ? "答案要点" : "答案"}
                  </div>
                  <div className="text-sm text-emerald-900 dark:text-emerald-100">
                    <LatexText>{answerText}</LatexText>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div
            className={cn(
              "grid transition-all duration-500 ease-out",
              showDetails ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="space-y-3 border-t border-border/60 pt-3">
              {renderCodeAnswer(question)}
              {mode === "detailed" && question.analysis ? (
                <div className="rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-2 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-300/80">
                    解析
                  </div>
                  <div className="text-sm text-sky-950 dark:text-sky-50">
                    {question.analysis.startsWith("<") ? (
                      <RichContent html={question.analysis} />
                    ) : (
                      <RenderTextWithCode
                        text={question.analysis}
                        language={(question.content?.language as string) || undefined}
                      />
                    )}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={diff.variant}>{diff.label}</Badge>
                <span className="text-xs text-muted-foreground">{question.score} 分</span>

                {question.tags.length > 0 ? (
                  <>
                    <span className="h-3.5 w-px bg-border" />
                    <span className="text-emerald-600 dark:text-emerald-400">
                      <Tag size={11} />
                    </span>
                    {question.tags.slice(0, 4).map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[11px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                      >
                        {tag.name}
                      </Badge>
                    ))}
                    {question.tags.length > 4 ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="rounded px-1 py-0.5 text-xs text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          >
                            +{question.tags.length - 4}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto max-w-60 p-2" align="start">
                          <div className="flex flex-wrap gap-1">
                            {question.tags.slice(4).map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[11px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </>
                ) : null}

                {question.knowledge_points.length > 0 ? (
                  <>
                    <span className="h-3.5 w-px bg-border" />
                    <span className="text-indigo-600 dark:text-indigo-400">
                      <GraduationCap size={12} />
                    </span>
                    {question.knowledge_points.map((knowledgePoint) => (
                      <Badge
                        key={knowledgePoint.id}
                        variant="outline"
                        className="border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[11px] text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-400"
                      >
                        {knowledgePoint.name}
                      </Badge>
                    ))}
                  </>
                ) : null}
              </div>

              {actions ? <div className="flex items-center justify-end gap-1">{actions}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
