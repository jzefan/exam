import { ChevronDown, FilePlus2, ListChecks, LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PracticePublishMenuProps {
  /** 进入多步「新建练习」向导。 */
  onCreate: () => void;
  /** 打开智能创建练习。 */
  onSmartCreate: () => void;
  /** 用本课程题库全部题目直接发起练习。 */
  onWholeBank: () => void;
  /** 正在加载整库题目。 */
  loading?: boolean;
  className?: string;
}

/**
 * 课程详情里统一的「发布练习」下拉：新建练习 / 智能创建练习 / 本课程题库作为练习。
 * 练习页签与题目页签共用同一套入口，避免两处操作口径不一致。
 * 每个菜单项带悬浮提示，说明什么场景该选哪个。
 */
export function PracticePublishMenu({
  onCreate,
  onSmartCreate,
  onWholeBank,
  loading = false,
  className,
}: PracticePublishMenuProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            className={cn(className)}
          >
            {loading ? (
              <LoaderCircle
                size={14}
                className="mr-1.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <FilePlus2 size={14} className="mr-1.5" aria-hidden="true" />
            )}
            发布练习
            <ChevronDown size={13} className="ml-1.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem onSelect={onCreate}>
                <FilePlus2 size={14} className="mr-2" />
                新建练习
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60">
              进入多步向导，逐步设置知识点、题目、学生与发布时间
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem onSelect={onSmartCreate}>
                <Sparkles size={14} className="mr-2" />
                智能创建练习
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60">
              按条件、比例或提示词快速组题，适合日常随堂练习
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem disabled={loading} onSelect={onWholeBank}>
                <ListChecks size={14} className="mr-2" />
                本课程题库作为练习
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60">
              直接用本课程题库的全部题目发布，发布后仍可删减
            </TooltipContent>
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
