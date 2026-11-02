import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders text with inline ($...$) and block ($$...$$) LaTeX formulas.
 * Non-LaTeX text is rendered as plain text (HTML-escaped).
 */
export function LatexText({ children, className }: { children: string | number | null | undefined; className?: string }) {
  const safe = typeof children === "string" ? children : children == null ? "" : String(children);
  const html = useMemo(() => renderLatex(safe), [safe]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Regex: match $$...$$ (block) or $...$ (inline), non-greedy
const LATEX_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$)/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFormula(match: string): string {
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
}

/** Render LaTeX in plain text, escaping all surrounding text before injecting HTML. */
export function renderLatex(text: string): string {
  if (typeof text !== "string") return "";
  const matcher = new RegExp(LATEX_RE.source, "g");
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(matcher)) {
    const value = match[0];
    const index = match.index ?? 0;
    result += escapeHtml(text.slice(cursor, index));
    result += renderFormula(value);
    cursor = index + value.length;
  }

  return result + escapeHtml(text.slice(cursor));
}

/**
 * 给题目 HTML 里的表格补上统一样式类。
 *
 * 题目正文在题库、课程、作答、考后查看、阅卷等处由不同组件渲染，
 * 但都走 `renderLatexInHtml`；在这里统一打标记，就能保证表格在各处都带边框、
 * 窄屏可横向滚动，不依赖每个容器各自写一遍 `prose` 表样式。
 */
export function decorateQuestionHtml(html: string): string {
  if (typeof html !== "string" || !html || !/<table/i.test(html)) return html;
  return html.replace(/<table(\s[^>]*)?>/gi, (_match: string, attrs: string | undefined) => {
    const attributes = attrs ?? "";
    if (/class\s*=/i.test(attributes)) {
      return `<table${attributes.replace(
        /class\s*=\s*(["'])([^"']*)\1/i,
        (_m, quote: string, value: string) =>
          /\bquestion-table\b/.test(value)
            ? `class=${quote}${value}${quote}`
            : `class=${quote}${value} question-table${quote}`,
      )}>`;
    }
    return `<table${attributes} class="question-table">`;
  });
}

/**
 * Render LaTeX formulas within HTML content.
 * Processes text nodes only, so formulas are decoded from HTML entities and tags/attributes stay intact.
 */
export function renderLatexInHtml(html: string): string {
  if (typeof html !== "string" || !html) return "";
  const decorated = decorateQuestionHtml(html);
  if (!new RegExp(LATEX_RE.source).test(decorated)) return decorated;

  if (typeof document === "undefined") {
    const matcher = new RegExp(LATEX_RE.source, "g");
    return decorated.replace(/(<[^>]+>)|([^<]+)/g, (_match, tag: string | undefined, text: string | undefined) => {
      if (tag) return tag;
      if (!text) return "";
      return text.replace(matcher, renderFormula);
    });
  }

  const template = document.createElement("template");
  template.innerHTML = decorated;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    if (!new RegExp(LATEX_RE.source).test(value)) continue;

    let parent = textNode.parentElement;
    let insideCode = false;
    while (parent) {
      if (parent.matches("code, pre, script, style, .katex")) {
        insideCode = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (insideCode) continue;

    const replacement = document.createElement("template");
    replacement.innerHTML = renderLatex(value);
    textNode.replaceWith(replacement.content);
  }

  return template.innerHTML;
}
