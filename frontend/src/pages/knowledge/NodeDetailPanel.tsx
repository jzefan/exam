import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Difficulty, IKnowledgePointDetail } from "./types";

interface Props {
  open: boolean;
  initial: Partial<IKnowledgePointDetail> & { directionId: string };
  onSave: (data: Partial<IKnowledgePointDetail>) => Promise<void>;
  onClose: () => void;
}

const DIFFICULTIES: Difficulty[] = ["入门", "初级", "中级", "高级", "困难"];

export function NodeDetailPanel({ open, initial, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodeLabel = initial.parent_id ? "子知识" : "主知识/技能";

  useEffect(() => {
    if (open) {
      setName(initial.name ?? "");
      setDescription(initial.description ?? "");
      setTags((initial.tags ?? []).join(", "));
      setDifficulty((initial.difficulty as Difficulty) ?? "");
      setError(null);
    }
  }, [initial, open]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        difficulty: difficulty || null,
      });
      onClose();
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial.id ? `编辑${nodeLabel}` : `新建${nodeLabel}`}</DialogTitle>
          <DialogDescription>填写{nodeLabel}名称、描述、标签和难度信息。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="knowledge-name">名称 *</Label>
            <Input id="knowledge-name" onChange={(event) => setName(event.target.value)} value={name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="knowledge-description">描述</Label>
            <Textarea
              id="knowledge-description"
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              value={description}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="knowledge-tags">标签（逗号分隔）</Label>
            <Input
              id="knowledge-tags"
              onChange={(event) => setTags(event.target.value)}
              placeholder="算法, 数据结构"
              value={tags}
            />
          </div>
          <div className="space-y-2">
            <Label>难度</Label>
            <Select value={difficulty || "__none__"} onValueChange={(value) => setDifficulty(value === "__none__" ? "" : (value as Difficulty))}>
              <SelectTrigger>
                <SelectValue placeholder="不设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">不设置</SelectItem>
                {DIFFICULTIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
