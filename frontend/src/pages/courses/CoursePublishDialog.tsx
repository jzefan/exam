import { useEffect, useState } from "react";
import { Check, Copy, Globe, Link2, Loader2, PowerOff, Sparkles } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import {
  createCoursePublishLink,
  getCoursePublishLink,
  revokeCoursePublishLink,
  type CourseShareLinkResponse,
} from "./api";

interface CoursePublishDialogProps {
  courseId: string;
  courseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CoursePublishDialog({
  courseId,
  courseName,
  open,
  onOpenChange,
}: CoursePublishDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkData, setLinkData] = useState<CourseShareLinkResponse | null>(null);

  useEffect(() => {
    if (!open || !courseId) return;
    let active = true;
    setLoading(true);
    getCoursePublishLink(courseId)
      .then((data) => {
        if (active) setLinkData(data);
      })
      .catch(() => {
        if (active) setLinkData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, courseId]);

  const handleCopy = async () => {
    if (!linkData?.share_url) return;
    try {
      await navigator.clipboard.writeText(linkData.share_url);
      setCopied(true);
      toast({ title: "已复制短链接到剪贴板" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "复制失败，请手动选中文本复制", variant: "destructive" });
    }
  };

  const handlePublishOrRefresh = async () => {
    setActing(true);
    try {
      const res = await createCoursePublishLink(courseId);
      setLinkData(res);
      toast({ title: "课程短链接已发布", description: "任何持有链接的用户可直接访问该课程" });
    } catch (err) {
      toast({
        title: "发布失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setActing(false);
    }
  };

  const handleRevoke = async () => {
    setActing(true);
    try {
      await revokeCoursePublishLink(courseId);
      setLinkData(null);
      toast({ title: "已停用课程短链接" });
    } catch (err) {
      toast({
        title: "停用失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Globe size={18} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">发布课程短链接</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                发布后，任何用户无需从平台登录或查找课程，点击链接即可直接进入。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {loading ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              <Loader2 size={18} className="mr-2 animate-spin" />
              正在检查发布状态...
            </div>
          ) : linkData ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
                <div className="flex items-center justify-between text-xs font-medium text-foreground">
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    短链接已生效
                  </span>
                  <span className="text-muted-foreground">短链识别码：{linkData.share_code}</span>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      readOnly
                      value={linkData.share_url}
                      className="h-8 pl-8 pr-2 font-mono text-xs select-all bg-background"
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                  <Button size="sm" className="h-8 shrink-0 gap-1" onClick={handleCopy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">用户进入后享有的功能：</p>
                <ul className="list-inside list-disc space-y-0.5 pl-1">
                  <li>直接浏览并使用知识点树、资料文档、题库和测试试卷</li>
                  <li>自主创建自己的学期、班级（学生）并发布练习/考试</li>
                  <li>自动查看答卷得分与主观题 AI 智能评分</li>
                  <li>设置独立工作区密码，自建资料与题目对其他用户完全保密</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Link2 size={20} />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">尚未发布课程短链接</p>
              <p className="mt-1 text-xs text-muted-foreground">
                生成短链接后，你可以将其分享给其他教师或学生，他们可立即进入「{courseName}」。
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          {linkData ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
              disabled={acting}
              onClick={handleRevoke}
            >
              <PowerOff size={14} />
              停用短链接
            </Button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
            {!linkData ? (
              <Button
                type="button"
                size="sm"
                disabled={acting}
                onClick={handlePublishOrRefresh}
                className="gap-1.5"
              >
                {acting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                立即发布短链接
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
