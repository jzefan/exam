import { useState, useRef, useEffect, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

const MAX_WIDTH = 600;
const MAX_HEIGHT = 400;

function ExpandableImage({ src, alt }: { src: string; alt?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Reset expanded state when src changes
    setExpanded(false);
  }, [src]);

  const handleLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const computeStyle = (): CSSProperties => {
    if (!naturalSize) {
      return { maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT, objectFit: "contain" as const };
    }

    if (expanded) {
      // Show at natural size, no max constraints
      return { width: naturalSize.w, height: "auto" };
    }

    // Constrained: fit within MAX_WIDTH x MAX_HEIGHT, but don't upscale
    const w = Math.min(naturalSize.w, MAX_WIDTH);
    const scale = w / naturalSize.w;
    const h = naturalSize.h * scale;

    if (h > MAX_HEIGHT) {
      const hScale = MAX_HEIGHT / naturalSize.h;
      return {
        width: naturalSize.w * hScale,
        height: MAX_HEIGHT,
      };
    }

    return { width: w, height: h };
  };

  const isConstrained =
    naturalSize !== null &&
    (naturalSize.w > MAX_WIDTH || naturalSize.h > MAX_HEIGHT);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt ?? ""}
      onLoad={handleLoad}
      onClick={isConstrained ? () => setExpanded((prev) => !prev) : undefined}
      className={cn(
        "rounded my-1 block transition-all duration-200",
        isConstrained && "cursor-pointer hover:opacity-90",
      )}
      style={computeStyle()}
    />
  );
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
  // Split HTML into segments: img tags vs everything else
  const segments = html.split(/(<img\s[^>]*?>)/gi);

  if (segments.length === 1 && !/<img\s/i.test(html)) {
    // No images — render as plain HTML
    return (
      <div
        className={cn("prose prose-sm max-w-none", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      {segments.map((segment, i) => {
        const imgMatch = segment.match(
          /^<img\s[^>]*?src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*?>$/i,
        );
        if (imgMatch) {
          return <ExpandableImage key={i} src={imgMatch[1]} alt={imgMatch[2]} />;
        }
        // Also try alt before src
        const imgMatch2 = segment.match(
          /^<img\s[^>]*?alt=["']([^"']*)["'][^>]*?src=["']([^"']+)["'][^>]*?>$/i,
        );
        if (imgMatch2) {
          return <ExpandableImage key={i} src={imgMatch2[2]} alt={imgMatch2[1]} />;
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
