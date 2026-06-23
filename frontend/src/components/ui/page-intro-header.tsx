import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

interface PageIntroHeaderProps {
  title: string;
  description: string;
  onBack?: () => void | Promise<void>;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
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
  embedded = false,
}: PageIntroHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 sm:px-6",
        embedded ? "w-full" : "relative left-1/2 -ml-[50vw] -mt-6 w-screen",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            aria-label={backLabel ?? "返回"}
            className="size-8 shrink-0 rounded-lg p-0 transition-all hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="font-serif text-sm font-semibold tracking-tight text-foreground lg:text-base">
            {title}
          </h1>
          <p className="mt-0.5 max-w-[560px] text-xs leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
