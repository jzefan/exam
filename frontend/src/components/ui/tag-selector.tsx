import { useState, useRef } from "react";
import { useCreate, useInvalidate } from "@refinedev/core";
import { Plus, X } from "lucide-react";
import type { ITag } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

interface TagSelectorProps {
  allTags: ITag[];
  selectedTagIds: string[];
  onChange: (ids: string[]) => void;
}

export function TagSelector({ allTags, selectedTagIds, onChange }: TagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate: createTag } = useCreate();
  const invalidate = useInvalidate();

  const removeTag = (id: string) => {
    onChange(selectedTagIds.filter((t) => t !== id));
  };

  const addTag = (id: string) => {
    onChange([...selectedTagIds, id]);
    setOpen(false);
    setSearch("");
  };

  const handleCreateAndAdd = () => {
    const name = search.trim();
    if (!name) return;

    // Check if tag already exists (case-insensitive)
    const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        addTag(existing.id);
      }
      return;
    }

    createTag(
      {
        resource: "tags",
        values: { name, type: "custom" },
      },
      {
        onSuccess: (data) => {
          const newTag = data.data as unknown as ITag;
          onChange([...selectedTagIds, newTag.id]);
          invalidate({ resource: "tags", invalidates: ["list"] });
          setOpen(false);
          setSearch("");
        },
      },
    );
  };

  const availableTags = allTags.filter((t) => !selectedTagIds.includes(t.id));
  const hasExactMatch = allTags.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTagIds.map((id) => {
        const tag = allTags.find((t) => t.id === id);
        if (!tag) return null;
        return (
          <Badge key={id} variant="secondary" className="gap-1 pr-1">
            {tag.name}
            <button
              type="button"
              onClick={() => removeTag(id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
            >
              <X size={12} />
            </button>
          </Badge>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus size={12} />
            添加标签
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-0" align="start">
          <Command shouldFilter={true}>
            <CommandInput
              ref={inputRef}
              placeholder="搜索或输入新标签..."
              value={search}
              onValueChange={setSearch}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim() && !hasExactMatch) {
                  e.preventDefault();
                  handleCreateAndAdd();
                }
              }}
            />
            <CommandList>
              <CommandGroup>
                {availableTags.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => addTag(t.id)}
                  >
                    {t.name}
                  </CommandItem>
                ))}
              </CommandGroup>
              {search.trim() && !hasExactMatch && (
                <CommandGroup>
                  <CommandItem
                    value={`__create__${search}`}
                    onSelect={handleCreateAndAdd}
                    className="text-primary"
                  >
                    <Plus size={12} className="mr-1" />
                    创建「{search.trim()}」
                  </CommandItem>
                </CommandGroup>
              )}
              {!search.trim() && availableTags.length === 0 && (
                <CommandEmpty>暂无标签，输入名称回车创建</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
