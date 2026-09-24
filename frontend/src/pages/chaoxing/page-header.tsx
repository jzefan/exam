import type { ReactNode } from "react";

interface ChaoxingPageHeaderProps {
  title: string;
  subtitle?: string;
  /** Shown in the middle of the title row, where a connection state belongs. */
  status?: ReactNode;
  actions: ReactNode;
}

export function ChaoxingPageHeader({ title, subtitle, status, actions }: ChaoxingPageHeaderProps) {
  return <header className="-mt-6 ml-[calc(50%-50vw)] w-screen border-b border-border/70 bg-background px-4 py-4 sm:px-6">
    {/* Equal side columns keep the status centered in the row rather than
        centered between the title and the actions. */}
    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="min-w-0"><h1 className="truncate text-base font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}</div>
      <div className={status ? "flex justify-center" : "hidden sm:block"}>{status}</div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
    </div>
  </header>;
}
