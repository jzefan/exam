import type { ReactNode } from "react";

interface ChaoxingPageHeaderProps {
  title: string;
  subtitle?: string;
  actions: ReactNode;
}

export function ChaoxingPageHeader({ title, subtitle, actions }: ChaoxingPageHeaderProps) {
  return <header className="-mt-6 ml-[calc(50%-50vw)] w-screen border-b border-border/70 bg-background px-4 py-4 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h1 className="truncate text-base font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
    </div>
  </header>;
}
