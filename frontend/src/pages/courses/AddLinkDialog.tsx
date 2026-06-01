import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { addCourseMaterialLink, type TeacherCourseMaterial } from "./api";

interface AddLinkDialogProps {
  courseId: string;
  courseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (material: TeacherCourseMaterial) => void;
}

export function AddLinkDialog({ courseId, courseName, open, onOpenChange, onCreated }: AddLinkDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setUrl("");
      setDescription("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 && url.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      // URL sanity-check — let users paste raw domains by prefixing the scheme.
      const normalizedUrl = /^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      new URL(normalizedUrl);
      setSubmitting(true);
      const material = await addCourseMaterialLink(courseId, {
        title: title.trim(),
        url: normalizedUrl,
        description: description.trim() || null,
      });
      toast({ title: "已添加链接", description: `《${material.title}》已挂到 ${courseName} 节点。` });
      onCreated(material);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "添加失败",
        description: error instanceof Error ? error.message : "请检查链接是否正确",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!submitting ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">添加链接</DialogTitle>
          <DialogDescription>外部链接会挂在当前课程节点下，供学生预览或下载。</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="add-link-title">标题</Label>
            <Input
              id="add-link-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="如：MapReduce 论文"
              autoFocus
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-link-url">链接</Label>
            <Input
              id="add-link-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://research.google/..."
              type="url"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-link-desc">简介（可选）</Label>
            <Textarea
              id="add-link-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="一句话说明这个资料的用途"
              rows={2}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
