import { useState } from "react";
import { cn } from "@/lib/utils";
import { renderLatexInHtml } from "@/components/ui/latex-text";

function ExpandableImage({ src, alt }: { src: string; alt?: string }) {
  const [expanded, setExpanded] = useState(false);
  const imageAlt = alt || "题目图片";

  return (
    <>
      <button
        type="button"
        aria-label={`预览图片：${imageAlt}`}
        onClick={() => setExpanded(true)}
        className="my-2 block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 p-1 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={src}
          alt={imageAlt}
          className="block max-h-80 max-w-full rounded object-contain"
          loading="lazy"
        />
      </button>

      {expanded && (
        <div
          role="dialog"
          aria-label="图片预览"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpanded(false)}
        >
          <button
            type="button"
            aria-label="关闭图片预览"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => setExpanded(false)}
          >
            关闭
          </button>
          <img
            src={src}
            alt={imageAlt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function parseImageTag(segment: string): { src: string; alt?: string } | null {
  if (typeof window === "undefined" || !/^<img\s/i.test(segment)) return null;

  const template = document.createElement("template");
  template.innerHTML = segment.trim();
  const image = template.content.querySelector("img");
  const src = image?.getAttribute("src");

  if (!src) return null;
  return {
    src,
    alt: image?.getAttribute("alt") ?? undefined,
  };
}

/**
 * Renders HTML content with expandable images.
 * Images are constrained to 600x400 max and expand in-place on click.
 */
export function RichContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  // Pre-process LaTeX in the HTML
  const processed = renderLatexInHtml(html);

  // Split HTML into segments: img tags vs everything else
  const segments = processed.split(/(<img\s[^>]*?>)/gi);

  if (segments.length === 1 && !/<img\s/i.test(processed)) {
    // No images — render as plain HTML
    return (
      <div
        className={cn(
          "prose prose-sm max-w-none [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto",
        className,
      )}
    >
      {segments.map((segment, i) => {
        const image = parseImageTag(segment);
        if (image) {
          return <ExpandableImage key={i} src={image.src} alt={image.alt} />;
        }
        if (!segment) return null;
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: segment }}
          />
        );
      })}
    </div>
  );
}
