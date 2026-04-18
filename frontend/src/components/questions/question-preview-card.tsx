import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { GraduationCap, Tag } from "lucide-react";

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
  questionDifficultyConfig,
  questionTypeChar,
  questionTypeColorClass,
} from "./question-preview-utils";

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

function renderOptions(question: IQuestion) {
  if (question.type !== "choice" || !question.options) {
    return null;
  }

  const entries = Object.entries(question.options as Record<string, string>);
  const maxLen = Math.max(...entries.map(([, value]) => value.length));
  const layoutClass =
    maxLen > 30
      ? "grid grid-cols-1 gap-y-0.5"
      : maxLen > 10
        ? "grid grid-cols-2 gap-x-6 gap-y-0.5"
        : "flex flex-wrap gap-x-8 gap-y-0.5";

  return (
    <div className={cn("mt-2", layoutClass)}>
      {entries.map(([key, value]) => (
        <span key={key} className="text-sm text-muted-foreground">
          {key}. <LatexText>{value}</LatexText>
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
  expandOnHover = false,
  hoverDetailDelay = 180,
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
  expandOnHover?: boolean;
  hoverDetailDelay?: number;
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

  useEffect(() => {
    if (!expandOnHover) {
      setIsHoverExpanded(false);
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
    } else {
      setIsHoverExpanded(false);
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
      className={cn("rounded-lg border border-border bg-card p-3 sm:p-4", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...props}
    >
      <div className="flex gap-2">
        {typeof index === "number" ? (
          <div className="w-5 flex-shrink-0 pt-0.5 text-left text-sm font-bold text-muted-foreground">
            {index}.
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {html ? (
              <RichContent html={html} className="flex-1 text-sm leading-relaxed text-foreground" />
            ) : (
              <p className="flex-1 text-sm leading-relaxed text-foreground"><LatexText>{getQuestionTitle(question)}</LatexText></p>
            )}
            {(trailing || !hideTypeBadge) && (
              <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                {!hideTypeBadge ? (
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold",
                      question.type === "choice" && isMultiChoice(question)
                        ? "bg-cyan-500 text-white"
                        : questionTypeColorClass[question.type],
                    )}
                  >
                    {question.type === "choice"
                      ? isMultiChoice(question)
                        ? "多"
                        : "单"
                      : questionTypeChar[question.type]}
                  </div>
                ) : null}
                {trailing}
              </div>
            )}
          </div>

          {renderOptions(question)}
          {!hideAnswer && answerText !== "" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {question.type === "short_answer" || question.type === "essay" ? "答案要点：" : "答案："}
              <LatexText>{answerText}</LatexText>
            </p>
          ) : null}

          <div
            className={cn(
              "grid transition-all duration-500 ease-out",
              showDetails ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="space-y-2">
              {renderCodeAnswer(question)}
              {mode === "detailed" && question.analysis ? (
                <div className="text-sm text-muted-foreground">
                  <span className="text-xs text-muted-foreground/70">解析：</span>
                  {question.analysis.startsWith("<") ? (
                    <RichContent html={question.analysis} />
                  ) : (
                    <RenderTextWithCode
                      text={question.analysis}
                      language={(question.content?.language as string) || undefined}
                    />
                  )}
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
