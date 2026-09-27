import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { MarkdownLatex } from "@/components/ui/markdown-latex";
import { getStudentLocale, tStudent } from "../i18n";

interface SelectionTarget {
  questionId: string;
  text: string;
  left: number;
  top: number;
  bottom: number;
}

interface SelectionAIExplainProps {
  examId?: string;
  wrongAnswerId?: string;
  enabled: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function elementForNode(node: Node | null): Element | null {
  if (node instanceof Element) return node;
  return node?.parentElement ?? null;
}

export function SelectionAIExplain({ examId, wrongAnswerId, enabled }: SelectionAIExplainProps) {
  const locale = getStudentLocale();
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const openRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const closePanel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    openRef.current = false;
    setIsOpen(false);
    setIsStreaming(false);
    setTarget(null);
    setAnswer("");
    setError("");
  }, []);

  const readSelection = useCallback(() => {
    if (!enabled || openRef.current) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selection || !selectedText || !selection.rangeCount) {
      setTarget(null);
      return;
    }

    const anchorElement = elementForNode(selection.anchorNode);
    const focusElement = elementForNode(selection.focusNode);
    const questionScope = anchorElement?.closest<HTMLElement>("[data-ai-explain-question-id]");
    if (!questionScope || questionScope !== focusElement?.closest("[data-ai-explain-question-id]")) {
      setTarget(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setTarget(null);
      return;
    }

    setTarget({
      questionId: questionScope.dataset.aiExplainQuestionId ?? "",
      text: selectedText.slice(0, 1200),
      left: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      closePanel();
      return;
    }

    document.addEventListener("selectionchange", readSelection);
    document.addEventListener("mouseup", readSelection);
    document.addEventListener("touchend", readSelection);
    return () => {
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("mouseup", readSelection);
      document.removeEventListener("touchend", readSelection);
    };
  }, [closePanel, enabled, readSelection]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePanel, isOpen]);

  const explainSelection = async () => {
    if (!target || (!examId && !wrongAnswerId) || !target.questionId) return;

    openRef.current = true;
    setIsOpen(true);
    setIsStreaming(true);
    setAnswer("");
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem("access_token");
      const explainUrl = wrongAnswerId
        ? `/api/wrong-answers/${encodeURIComponent(wrongAnswerId)}/explain-selected/stream`
        : `/api/student/exams/${encodeURIComponent(examId!)}/questions/${encodeURIComponent(target.questionId)}/explain-selected/stream`;
      const response = await fetch(explainUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ selected_text: target.text }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? tStudent("ai_explain_failed", undefined, locale));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamFailed = false;

      const consumeEvent = (block: string) => {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) return false;

        try {
          const event = JSON.parse(data) as { type?: string; text?: string; message?: string };
          if (event.type === "delta" && event.text) {
            setAnswer((current) => current + event.text);
          } else if (event.type === "error") {
            setError(event.message || tStudent("ai_explain_failed", undefined, locale));
            streamFailed = true;
            return true;
          }
        } catch {
          // Ignore malformed or keep-alive SSE frames.
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (consumeEvent(block)) {
            await reader.cancel();
            break;
          }
        }
        if (streamFailed) break;
      }
      if (!streamFailed && buffer.trim()) consumeEvent(buffer);
      if (streamFailed) return;
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : tStudent("ai_explain_failed", undefined, locale),
        );
      }
    } finally {
      if (!controller.signal.aborted) setIsStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  if (!enabled || !target || typeof document === "undefined") return null;

  const panelWidth = Math.min(360, window.innerWidth - 24);
  const panelLeft = clamp(target.left - panelWidth / 2, 12, window.innerWidth - panelWidth - 12);
  const panelTop =
    target.bottom + 380 < window.innerHeight
      ? target.bottom + 10
      : Math.max(12, target.top - 370);
  const triggerTop =
    target.bottom + 42 < window.innerHeight
      ? target.bottom + 8
      : Math.max(8, target.top - 42);
  const triggerLeft = clamp(target.left - 58, 8, window.innerWidth - 124);

  return createPortal(
    <>
      {!isOpen ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void explainSelection()}
          className="fixed z-[140] inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-background px-3 text-xs font-medium text-primary shadow-md transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: triggerLeft, top: triggerTop }}
        >
          <Sparkles size={13} />
          {tStudent("ai_explain_action", undefined, locale)}
        </button>
      ) : (
        <section
          role="dialog"
          aria-label={tStudent("ai_explain_title", undefined, locale)}
          className="fixed z-[140] flex max-h-[min(420px,calc(100vh-24px))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
          style={{ left: panelLeft, top: panelTop, width: panelWidth }}
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Sparkles size={14} className="text-primary" />
            <h2 className="flex-1 text-sm font-semibold">
              {tStudent("ai_explain_title", undefined, locale)}
            </h2>
            {isStreaming ? <LoaderCircle size={14} className="animate-spin text-muted-foreground" /> : null}
            <button
              type="button"
              onClick={closePanel}
              aria-label={tStudent("common_cancel", undefined, locale)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto p-3">
            <p className="mb-2 line-clamp-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <span className="mr-1 font-medium text-foreground">
                {tStudent("ai_explain_selected_text", undefined, locale)}:
              </span>
              {target.text}
            </p>
            {answer ? (
              <MarkdownLatex className="text-sm leading-6 [&_.katex-display]:overflow-x-auto">
                {answer}
              </MarkdownLatex>
            ) : null}
            {isStreaming && !answer ? (
              <p className="text-sm text-muted-foreground">
                {tStudent("ai_explain_loading", undefined, locale)}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
        </section>
      )}
    </>,
    document.body,
  );
}
