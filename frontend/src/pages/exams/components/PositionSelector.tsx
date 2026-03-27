import { useState } from "react";
import { useList, useCreate } from "@refinedev/core";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { IPosition } from "@/types";

export function PositionSelector({
  id,
  value,
  onChange,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { query } = useList<IPosition>({
    resource: "positions",
    pagination: { currentPage: 1, pageSize: 200 },
  });
  const positions = query.data?.data ?? [];

  const { mutate: create, mutation } = useCreate();
  const isPending = mutation.isPending;

  const selected = positions.find((p) => p.id === value);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    create(
      { resource: "positions", values: { name } },
      {
        onSuccess: (resp) => {
          setNewName("");
          query.refetch();
          onChange((resp.data as IPosition).id);
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="w-full justify-between font-normal"
        >
          {selected ? selected.name : "选择岗位（可选）"}
          <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="max-h-60 overflow-y-auto p-1" role="listbox" aria-label="岗位列表">
          {/* Clear */}
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className="w-4" />
            <span className="text-muted-foreground">不选择岗位</span>
          </button>

          {positions.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === value}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
            >
              <span className="w-4 shrink-0">
                {p.id === value && <Check size={14} />}
              </span>
              <span>{p.name}</span>
              {p.is_system && (
                <span className="text-xs text-muted-foreground ml-auto">系统</span>
              )}
            </button>
          ))}
        </div>

        {/* Inline create */}
        <div className="border-t p-2">
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="输入新岗位名称"
              placeholder="输入新岗位名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="h-8 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 shrink-0"
              disabled={!newName.trim() || isPending}
              onClick={handleCreate}
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
