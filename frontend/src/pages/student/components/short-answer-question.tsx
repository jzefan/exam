import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Database, Lightbulb } from "lucide-react";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

interface ShortAnswerContent extends Record<string, unknown> {
  text?: string;
  language?: string;
  answer_language?: string;
  editor_language?: string;
  starter_code?: string;
  placeholder?: string;
  hints?: string[];
  sql_hints?: string[];
}

const SQL_HINTS = [
  "先明确要查询的表，再补齐 SELECT / FROM / WHERE / GROUP BY 等结构。",
  "表别名尽量简短清晰，例如 `students s`、`courses c`。",
  "提交前检查字段名、聚合函数和排序条件是否写全。",
];

function getPromptText(question: IExamQuestionForStudent): string {
  const content = (question.content ?? {}) as ShortAnswerContent;
  return `${question.title} ${(content.text as string | undefined) ?? ""}`.toLowerCase();
}

function shouldOfferSqlAssist(question: IExamQuestionForStudent): boolean {
  const prompt = getPromptText(question);
  return (
    prompt.includes("数据库") ||
    prompt.includes("数据表") ||
    prompt.includes("表中") ||
    prompt.includes("字段") ||
    prompt.includes("table") ||
    prompt.includes("column") ||
    prompt.includes("查询") ||
    prompt.includes("筛选") ||
    prompt.includes("student表") ||
    prompt.includes("from ")
  );
}

function decodeStoredHtml(html: string): string {
  if (!html.trim()) return "";
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  return withoutTags.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ShortAnswerQuestion({ question, answer, onChange }: Props) {
  const { resolved } = useTheme();
  const content = (question.content ?? {}) as ShortAnswerContent;
  const answerLanguage = typeof answer?.language === "string" ? answer.language.toLowerCase() : null;
  const showSqlAssist = shouldOfferSqlAssist(question);
  const [manualSqlMode, setManualSqlMode] = useState(answerLanguage === "sql");
  const isSqlQuestion = manualSqlMode || answerLanguage === "sql";
  const html = (answer?.html as string) ?? "";
  const sqlValue = useMemo(() => {
    const code = answer?.code;
    if (typeof code === "string" && code.trim()) return code;
    if (typeof html === "string" && html.trim()) return decodeStoredHtml(html);
    const starter = content.starter_code;
    return typeof starter === "string" ? starter : "";
  }, [answer?.code, content.starter_code, html]);
  const promptHtml = (content.text as string | undefined) ?? question.title;
  const sqlHints = Array.isArray(content.sql_hints)
    ? content.sql_hints
    : Array.isArray(content.hints)
      ? content.hints
      : SQL_HINTS;

  if (!isSqlQuestion) {
    return (
      <div className="space-y-5">
        <div
          className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: renderLatexInHtml(promptHtml),
          }}
        />
        {showSqlAssist ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setManualSqlMode(true)}
            >
              <Database data-icon="inline-start" />
              编写 SQL
            </Button>
          </div>
        ) : null}
        <RichTextEditor
          value={html}
          onChange={(nextHtml) => onChange({ html: nextHtml })}
          placeholder="请输入答案..."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{
          __html: renderLatexInHtml(promptHtml),
        }}
      />

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Database className="size-4 text-primary" />
            SQL 编辑器
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setManualSqlMode(false)}
            >
              返回普通作答
            </Button>
            <span className="text-xs text-muted-foreground">
              支持 SQL 语法高亮与基础提示
            </span>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1.45fr)_220px]">
          <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
            <Editor
              height="320px"
              language="sql"
              theme={resolved === "dark" ? "vs-dark" : "vs"}
              value={sqlValue}
              onChange={(value) => {
                const nextCode = value ?? "";
                onChange({
                  language: "sql",
                  code: nextCode,
                  html: `<pre><code class="language-sql">${escapeHtml(nextCode)}</code></pre>`,
                });
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineHeight: 22,
                roundedSelection: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                quickSuggestions: true,
                suggestOnTriggerCharacters: true,
                tabSize: 2,
                padding: { top: 14, bottom: 14 },
                placeholder:
                  (typeof content.placeholder === "string" && content.placeholder.trim()) ||
                  "请在这里编写 SQL 语句",
              }}
            />
          </div>

          <aside className="rounded-xl bg-muted/35 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Lightbulb className="size-4 text-primary" />
              SQL 提示
            </div>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm leading-6 text-muted-foreground">
              {sqlHints.map((hint) => (
                <li key={hint} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
    </div>
  );
}
