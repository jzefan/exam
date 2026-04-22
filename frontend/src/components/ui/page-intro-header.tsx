import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

interface PageIntroHeaderProps {
  title: string;
  description: string;
  onBack: () => void;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
  fullBleed?: boolean;
}

export function PageIntroHeader({
  title,
  description,
  onBack,
  backLabel,
  actions,
  className,
  fullBleed = false,
}: PageIntroHeaderProps) {
  return (
    <div
      className={cn(
        "-mx-4 -mt-6 flex min-h-14 items-center justify-between gap-4 border-b border-slate-100 bg-white px-4 py-3 sm:-mx-6 sm:px-6",
        fullBleed && "relative left-1/2 w-screen -translate-x-1/2 mx-0 sm:mx-0",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          aria-label={backLabel ?? "返回"}
          className="size-8 shrink-0 rounded-lg border-slate-200 p-0 transition-all hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight text-slate-900 lg:text-base">{title}</h1>
          <p className="mt-0.5 max-w-[560px] text-xs leading-snug text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
