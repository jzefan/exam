import type * as React from "react";

import { Button, type ButtonProps } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

type TooltipButtonProps = Omit<ButtonProps, "title"> & {
  tooltip: React.ReactNode;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  tooltipAlign?: React.ComponentProps<typeof TooltipContent>["align"];
};

export function TooltipButton({
  tooltip,
  tooltipSide = "top",
  tooltipAlign = "center",
  disabled,
  children,
  ...buttonProps
}: TooltipButtonProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button disabled={disabled} {...buttonProps}>
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} align={tooltipAlign}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
