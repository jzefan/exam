import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Check, Clock3, Copy, GraduationCap, Loader2, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IQuestion } from "@/types";
import { Badge } from "@/components/ui/badge";
import { CodeBlock, highlightCode } from "@/components/ui/code-block";
import { LatexText } from "@/components/ui/latex-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RichContent } from "@/components/ui/rich-content";
import {
  getQuestionAnswerText,
  getQuestionContentHtml,
  getQuestionTitle,
  isMultiChoice,
  normalizeQuestionType,
  questionTypeFullLabel,
} from "./question-preview-utils";
import type { QuestionKnowledgeRecognitionStatus } from "@/pages/questions/question-knowledge-recognition";

const knowledgeRecognitionConfig: Record<
  QuestionKnowledgeRecognitionStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  waiting: {
    label: "等待 AI 识别",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
    icon: Clock3,
  },
  running: {
    label: "AI 识别中",
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
    icon: Loader2,
  },
};

function RenderTextWithCode({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
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
              className="rounded-sm bg-primary/15 px-0.5 text-inherit"
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

/* ── difficulty bars ── */
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "容易",
  2: "较易",
  3: "中等",
  4: "较难",
  5: "很难",
};

function DifficultyBars({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-1 rounded-[1px]",
            i <= level ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

/* ── section label (colored dot · eyebrow · divider) ── */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-[2px] bg-primary" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ── code answer block with chrome, line numbers and copy ── */
function CodeAnswerBlock({
  code,
  language = "python",
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  const trimmed = code.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "");
  const lines = trimmed ? trimmed.split("\n") : [""];

  const handleCopy = () => {
    navigator.clipboard?.writeText(trimmed);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-primary/30" />
            <span className="h-2 w-2 rounded-full bg-border" />
            <span className="h-2 w-2 rounded-full bg-primary/50" />
          </span>
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            copied
              ? "border-transparent bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <div className="max-h-[280px] overflow-auto">
        <div className="min-w-max py-2">
          {lines.map((line, i) => (
            <div
              key={`${i}-${line}`}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)]"
            >
              <span
                aria-hidden="true"
                className="sticky left-0 z-10 select-none border-r border-border bg-muted/30 px-3 text-right font-mono text-[12px] leading-6 text-muted-foreground/60"
              >
                {i + 1}
              </span>
              <code
                className="hljs whitespace-pre bg-transparent px-3 font-mono text-[12px] leading-6"
                dangerouslySetInnerHTML={{
                  __html: line ? highlightCode(line, language) : "&nbsp;",
                }}
              />
            </div>
          ))}
        </div>
      </div>
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
    if (
      question.type !== "choice" ||
      !question.options ||
      !containerRef.current
    ) {
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
      const font =
        computedStyle.font ||
        `${computedStyle.fontSize} ${computedStyle.fontFamily}`;
      const gap = 24;
      const itemPadding = 16;
      const optionWidths = entries.map(
        ([key, value]) =>
          measureTextWidth(`${key}. ${value}`, font) + itemPadding,
      );

      const totalInlineWidth =
        optionWidths.reduce((sum, current) => sum + current, 0) +
        gap * Math.max(entries.length - 1, 0);
      if (totalInlineWidth <= width) {
        setLayout("single-row");
        return;
      }

      const twoColumnWidth = (width - gap) / 2;
      const canUseTwoColumns = optionWidths.every(
        (optionWidth) => optionWidth <= twoColumnWidth,
      );
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
            layout === "single-row"
              ? "min-w-0 whitespace-nowrap"
              : "min-w-0 break-words",
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
  onClick,
  onMouseEnter,
  onMouseLeave,
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
  const [isHoverExpansionSuppressed, setIsHoverExpansionSuppressed] =
    useState(false);
  const hoverExpandTimerRef = useRef<number | null>(null);

  const answerText = getQuestionAnswerText(question);
  const isExpanded = expanded ?? defaultExpanded;
  const showDetails = expandOnHover
    ? isHoverExpanded
    : mode === "detailed"
      ? isExpanded
      : defaultExpanded;
  const html = getQuestionContentHtml(question);
  const normalizedType = normalizeQuestionType(question.type);
  const isCode = normalizedType === "code";

  const typeLabel = normalizedType
    ? normalizedType === "choice"
      ? isMultiChoice(question)
        ? "多选题"
        : "单选题"
      : questionTypeFullLabel[normalizedType]
    : "题目";

  const difficultyLabel =
    DIFFICULTY_LABELS[question.difficulty] ?? String(question.difficulty);
  const headerKnowledge = question.knowledge_points
    .slice(0, 2)
    .map((kp) => kp.name)
    .join(" · ");

  const codeAnswer =
    (question.answer?.code as string | undefined) ||
    (question.answer?.text as string | undefined) ||
    (question.answer?.correct as string | undefined);
  const codeLanguage = (question.content?.language as string) || "python";
  const hasAnswerText = answerText !== "" && answerText !== "-";
  const shouldShowAnswer =
    showDetails &&
    (!hideAnswer || hasAnswerText || (isCode && Boolean(codeAnswer)));

  const showSimpleAnswer =
    !showDetails && !hideAnswer && !isCode && hasAnswerText;

  const updatedLabel = (() => {
    try {
      return formatDistanceToNow(new Date(question.updated_at), {
        addSuffix: true,
        locale: zhCN,
      });
    } catch {
      return null;
    }
  })();

  const recognitionMeta = knowledgeRecognitionStatus
    ? knowledgeRecognitionConfig[knowledgeRecognitionStatus]
    : null;
  const RecognitionIcon = recognitionMeta?.icon;

  useEffect(() => {
    if (!expandOnHover) {
      return;
    }

    if (hoverExpandTimerRef.current) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }

    if (isHovered && !isHoverExpansionSuppressed) {
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
  }, [expandOnHover, hoverDetailDelay, isHoverExpansionSuppressed, isHovered]);

  const handleMouseEnter: HTMLAttributes<HTMLDivElement>["onMouseEnter"] = (
    event,
  ) => {
    onMouseEnter?.(event);
    setIsHovered(true);
  };

  const handleMouseLeave: HTMLAttributes<HTMLDivElement>["onMouseLeave"] = (
    event,
  ) => {
    onMouseLeave?.(event);
    setIsHovered(false);
    setIsHoverExpanded(false);
    setIsHoverExpansionSuppressed(false);
  };

  const handleClick: HTMLAttributes<HTMLDivElement>["onClick"] = (event) => {
    if (expandOnHover) {
      if (hoverExpandTimerRef.current) {
        window.clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = null;
      }
      setIsHoverExpanded(false);
      setIsHoverExpansionSuppressed(true);
    }
    onClick?.(event);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-1 sm:px-5">
        {typeof index === "number" ? (
          <span className="min-w-[1.25rem] font-serif text-lg font-bold tabular-nums text-foreground">
            {index}
          </span>
        ) : null}
        {!hideTypeBadge ? (
          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
            {typeLabel}
          </span>
        ) : null}
        {headerKnowledge ? (
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
            {headerKnowledge}
          </span>
        ) : null}

        <div className="flex-1" />

        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            {difficultyLabel}
          </span>
          <DifficultyBars level={question.difficulty} />
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="whitespace-nowrap font-serif text-sm font-semibold tabular-nums text-foreground">
          {question.score}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">
            分
          </span>
        </span>
        {trailing ? (
          <span className="ml-1 inline-flex items-center">{trailing}</span>
        ) : null}
      </div>

      {/* body */}
      <div className="px-2 py-2 sm:px-5">
        {html ? (
          <RichContent
            html={html}
            className="text-sm leading-relaxed text-foreground"
          />
        ) : (
          <p className="text-sm leading-relaxed text-foreground">
            {renderHighlightedLatexText(
              getQuestionTitle(question),
              highlightKeyword,
            )}
          </p>
        )}

        <ChoiceOptions
          question={question}
          highlightKeyword={highlightKeyword}
        />

        {recognitionMeta ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("gap-1.5 px-2 py-0.5", recognitionMeta.className)}
            >
              {RecognitionIcon ? (
                <RecognitionIcon
                  size={12}
                  className={
                    knowledgeRecognitionStatus === "running"
                      ? "animate-spin"
                      : undefined
                  }
                />
              ) : null}
              {recognitionMeta.label}
            </Badge>
          </div>
        ) : null}

        {/* simple answer (collapsed, non-code) */}
        {showSimpleAnswer ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              答案
            </span>
            <span className="text-sm text-foreground">
              <LatexText>{answerText}</LatexText>
            </span>
          </div>
        ) : null}

        {/* full details */}
        <div
          data-testid="question-preview-details"
          className={cn(
            "grid transition-all duration-500 ease-out",
            showDetails
              ? "mt-4 grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-5">
              {shouldShowAnswer ? (
                <div>
                  <SectionLabel>参考答案</SectionLabel>
                  {isCode ? (
                    codeAnswer ? (
                      <CodeAnswerBlock
                        code={codeAnswer}
                        language={codeLanguage}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">无</p>
                    )
                  ) : hasAnswerText ? (
                    <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-sm text-foreground">
                      <LatexText>{answerText}</LatexText>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">无</p>
                  )}
                </div>
              ) : null}

              {mode === "detailed" && question.analysis ? (
                <div>
                  <SectionLabel>解析</SectionLabel>
                  <div className="text-sm leading-relaxed text-muted-foreground">
                    {question.analysis.startsWith("<") ? (
                      <RichContent html={question.analysis} />
                    ) : (
                      <RenderTextWithCode
                        text={question.analysis}
                        language={
                          (question.content?.language as string) || undefined
                        }
                      />
                    )}
                  </div>
                </div>
              ) : null}

              {question.tags.length > 0 ||
              question.knowledge_points.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {question.tags.length > 0 ? (
                    <>
                      <Tag size={12} className="text-primary" />
                      {question.tags.slice(0, 4).map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="secondary"
                          className="px-1.5 py-0 text-[11px] font-normal"
                        >
                          {tag.name}
                        </Badge>
                      ))}
                      {question.tags.length > 4 ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="rounded px-1 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10"
                            >
                              +{question.tags.length - 4}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-auto max-w-60 p-2"
                            align="start"
                          >
                            <div className="flex flex-wrap gap-1">
                              {question.tags.slice(4).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  variant="secondary"
                                  className="px-1.5 py-0 text-[11px] font-normal"
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
                      {question.tags.length > 0 ? (
                        <span className="h-3.5 w-px bg-border" />
                      ) : null}
                      <GraduationCap size={13} className="text-primary" />
                      {question.knowledge_points.map((knowledgePoint) => (
                        <Badge
                          key={knowledgePoint.id}
                          variant="secondary"
                          className="px-1.5 py-0 text-[11px] font-normal"
                        >
                          {knowledgePoint.name}
                        </Badge>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}

              {/* footer */}
              {updatedLabel || question.usage_count > 0 || actions ? (
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    {updatedLabel ? <span>更新于 {updatedLabel}</span> : null}
                    {question.usage_count > 0 ? (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="tabular-nums">
                          用于 {question.usage_count} 份试卷
                        </span>
                      </>
                    ) : null}
                  </span>
                  {actions ? (
                    <div className="flex items-center gap-1">{actions}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
