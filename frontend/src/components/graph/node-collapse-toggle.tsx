import { Minus, Plus } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const NODE_COLLAPSE_TOGGLE_SELECTOR = "[data-node-collapse-toggle]";

type NodeCollapseToggleProps = {
  collapsed: boolean;
  count?: number;
  className?: string;
};

export function NodeCollapseToggle({
  collapsed,
  count,
  className,
}: NodeCollapseToggleProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-node-collapse-toggle
            aria-label={collapsed ? "展开子节点" : "收起子节点"}
            className={cn(
              "absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-background text-primary shadow-md ring-2 ring-background transition-all hover:scale-110 hover:border-primary hover:bg-primary hover:text-primary-foreground active:scale-95",
              className,
            )}
          >
            {collapsed ? (
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            ) : (
              <Minus className="h-3.5 w-3.5 stroke-[2.5]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {collapsed ? `展开子节点（${count ?? ""}）` : "收起子节点"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
