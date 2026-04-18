import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders text with inline ($...$) and block ($$...$$) LaTeX formulas.
 * Non-LaTeX text is rendered as plain text (HTML-escaped).
 */
export function LatexText({ children, className }: { children: string; className?: string }) {
  const html = useMemo(() => renderLatex(children), [children]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Regex: match $$...$$ (block) or $...$ (inline), non-greedy
const LATEX_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$)/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Render LaTeX in plain text — escapes non-LaTeX portions. */
export function renderLatex(text: string): string {
  return text.replace(LATEX_RE, (match) => {
    const isBlock = match.startsWith("$$");
    const formula = isBlock ? match.slice(2, -2).trim() : match.slice(1, -1).trim();
    try {
      return katex.renderToString(formula, {
        displayMode: isBlock,
        throwOnError: false,
        strict: "ignore",
        output: "html",
      });
    } catch {
      return `<code>${escapeHtml(formula)}</code>`;
    }
  });
}

/**
 * Render LaTeX formulas within HTML content.
 * Processes only text outside of HTML tags to avoid corrupting markup.
 */
export function renderLatexInHtml(html: string): string {
  if (!LATEX_RE.test(html)) return html;
  // Reset regex state
  LATEX_RE.lastIndex = 0;

  // Split by HTML tags — process only non-tag segments
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_match, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag;
    if (text) return renderLatex(text);
    return "";
  });
}
