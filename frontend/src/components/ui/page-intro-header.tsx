import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

interface PageIntroHeaderProps {
  title: string;
  description?: string;
  onBack?: () => void | Promise<void>;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
  /**
   * Single-line bar: hides the description and tightens vertical padding.
   * Use on workspace pages whose columns start directly under the header.
   */
  compact?: boolean;
  fullBleed?: boolean;
  /**
   * Render as a plain full-width bar without the negative-margin breakout.
   * Use inside full-screen pages that already manage their own layout/width.
   */
  embedded?: boolean;
}

export function PageIntroHeader({
  title,
  description,
  onBack,
  backLabel,
  actions,
  className,
  compact = false,
  embedded = false,
}: PageIntroHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border bg-card",
        compact
          ? "min-h-11 px-4 py-1.5 sm:px-6"
          : "min-h-12 px-4 py-3 sm:px-6",
        embedded ? "w-full" : "relative left-1/2 -ml-[50vw] -mt-6 w-screen",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center",
          compact ? "gap-2.5" : "gap-4",
        )}
      >
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            aria-label={backLabel ?? "返回"}
            className={cn(
              "shrink-0 rounded-lg p-0 transition-all hover:bg-muted",
              compact ? "size-7" : "size-8",
            )}
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="font-serif text-sm font-semibold tracking-tight text-foreground lg:text-base">
            {title}
          </h1>
          {!compact && description ? (
            <p className="mt-0.5 max-w-[560px] text-xs leading-snug text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
