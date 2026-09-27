import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { renderLatex } from "./latex-text";

interface MarkdownLatexProps {
  children: string | null | undefined;
  className?: string;
}

const MATH_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$)/g;
const TOKEN_RE = /\uE000\d+\uE001/g;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createTokenStore() {
  const values: string[] = [];
  return {
    add(html: string) {
      const token = `\uE000${values.length}\uE001`;
      values.push(html);
      return token;
    },
    restore(value: string) {
      return value.replace(TOKEN_RE, (token) => {
        const index = Number(token.slice(1, -1));
        return values[index] ?? token;
      });
    },
  };
}

function isSafeLink(url: string) {
  const normalized = url.replace(/&amp;/g, "&").trim();
  return /^(https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(normalized);
}

function renderInlineMarkdown(source: string, tokens: ReturnType<typeof createTokenStore>) {
  const protectedSource = source
    .replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, code: string) =>
      tokens.add(`<code>${escapeHtml(code)}</code>`),
    )
    .replace(new RegExp(MATH_RE.source, "g"), (formula) => tokens.add(renderLatex(formula)));

  let html = escapeHtml(protectedSource)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  html = html.replace(/!?\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, label: string, url: string) => {
    if (match.startsWith("!")) return label;
    if (!isSafeLink(url)) return label;
    return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  return tokens.restore(html.replace(/\n/g, "<br />"));
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderMarkdown(source: string) {
  const tokens = createTokenStore();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const protectedLines: string[] = [];
  let codeFence: { marker: string; language: string; lines: string[] } | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)(.*)$/);
    if (!codeFence && fenceMatch) {
      codeFence = { marker: fenceMatch[1][0], language: fenceMatch[2].trim().split(/\s+/)[0] ?? "", lines: [] };
      continue;
    }
    if (codeFence && new RegExp(`^\\s{0,3}${codeFence.marker}{3,}\\s*$`).test(line)) {
      const languageClass = codeFence.language
        ? ` class="language-${escapeHtml(codeFence.language)}"`
        : "";
      protectedLines.push(tokens.add(`<pre><code${languageClass}>${escapeHtml(codeFence.lines.join("\n"))}</code></pre>`));
      codeFence = null;
      continue;
    }
    if (codeFence) {
      codeFence.lines.push(line);
      continue;
    }
    protectedLines.push(line);
  }

  if (codeFence) {
    const languageClass = codeFence.language
      ? ` class="language-${escapeHtml(codeFence.language)}"`
      : "";
    protectedLines.push(tokens.add(`<pre><code${languageClass}>${escapeHtml(codeFence.lines.join("\n"))}</code></pre>`));
  }

  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listTag: "ol" | "ul" | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join("\n"), tokens)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listTag || !listItems.length) return;
    html.push(`<${listTag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item, tokens)}</li>`).join("")}</${listTag}>`);
    listItems = [];
    listTag = null;
  };

  for (let index = 0; index < protectedLines.length; index += 1) {
    const line = protectedLines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^\uE000\d+\uE001$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push(trimmed);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2], tokens)}</h${level}>`);
      continue;
    }

    if (/^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(line)) {
      flushParagraph();
      flushList();
      html.push("<hr />");
      continue;
    }

    if (index + 1 < protectedLines.length && line.includes("|") && isTableDivider(protectedLines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < protectedLines.length && protectedLines[index].trim() && protectedLines[index].includes("|")) {
        rows.push(splitTableRow(protectedLines[index]));
        index += 1;
      }
      index -= 1;
      const headerHtml = headers.map((cell) => `<th>${renderInlineMarkdown(cell, tokens)}</th>`).join("");
      const bodyHtml = rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] ?? "", tokens)}</td>`).join("")}</tr>`).join("");
      html.push(`<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const quoteLines = [quote[1]];
      while (index + 1 < protectedLines.length) {
        const nextQuote = protectedLines[index + 1].match(/^\s{0,3}>\s?(.*)$/);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      html.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join("\n"), tokens)}</p></blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s{0,3}([-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (listMatch) {
      flushParagraph();
      const nextTag = /^\d/.test(listMatch[1]) ? "ol" : "ul";
      if (listTag && listTag !== nextTag) flushList();
      listTag = nextTag;
      const taskItem = listMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
      if (taskItem) {
        const checked = taskItem[1].toLowerCase() === "x";
        listItems.push(`${checked ? "☑" : "☐"} ${taskItem[2]}`);
      } else {
        listItems.push(listMatch[2]);
      }
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return tokens.restore(html.join("\n"));
}

export function MarkdownLatex({ children, className }: MarkdownLatexProps) {
  const markdown = typeof children === "string" ? children : children ?? "";
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words text-inherit [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:my-3 [&_h2]:my-3 [&_h3]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0 [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_.markdown-table-wrap]:my-2 [&_.markdown-table-wrap]:overflow-x-auto [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
