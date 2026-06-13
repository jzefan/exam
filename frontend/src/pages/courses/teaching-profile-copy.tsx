// Shared "copy teaching profile from another source" control.
//
// 让「学期」和「出题技能」互相复制教学画像：技能编辑时从学期复制，新建学期时从技能复制。
//   - 0 个来源：不渲染
//   - 1 个来源：直接复制按钮（标签带来源名）
//   - 多个来源：下拉菜单选择
// 画像类型与 teachingProfileHasContent 见 teaching-profile.ts。

import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { TeachingProfile, TeachingProfileSource } from "./teaching-profile";

export function CopyTeachingProfileButton({
  sources,
  label,
  onCopy,
}: {
  /** 候选来源（调用方已过滤掉空画像）。 */
  sources: TeachingProfileSource[];
  /** 按钮文案，如 "从学期复制" / "从出题技能复制"。 */
  label: string;
  onCopy: (profile: TeachingProfile, sourceName: string) => void;
}) {
  if (sources.length === 0) return null;

  if (sources.length === 1) {
    const only = sources[0];
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
        onClick={() => onCopy(only.profile, only.name)}
        title={`从《${only.name}》复制教学画像`}
      >
        <Copy size={12} />
        {label}《{only.name}》
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
        >
          <Copy size={12} />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        {sources.map((source) => (
          <DropdownMenuItem key={source.id} onClick={() => onCopy(source.profile, source.name)}>
            <span className="truncate">{source.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
