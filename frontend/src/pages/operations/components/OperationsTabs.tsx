import { useLocation, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";

const TABS = [
  { value: "regrading", label: "重新批改", path: "/operations/regrading" },
  { value: "activity-logs", label: "活动日志", path: "/operations/activity-logs" },
] as const;

export function OperationsTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="inline-flex items-center rounded-lg border border-border/60 bg-background p-1">
      {TABS.map((tab) => {
        const active =
          location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`);
        return (
          <button
            key={tab.value}
            type="button"
            className={cn(
              "h-8 rounded-md px-3 text-xs font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
