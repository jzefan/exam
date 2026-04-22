import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PaperSummarySidebar({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("xl:sticky xl:top-6 xl:self-start", className)}>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="border-b border-border/60 px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <div className="max-h-[calc(100vh-8rem)] space-y-5 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </div>
    </aside>
  );
}
