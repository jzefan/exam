import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, ShieldAlert, ShieldCheck, Unlock } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import {
  clearCourseWorkspacePassword,
  getCourseWorkspaceSecurity,
  setCourseWorkspacePassword,
  type CourseWorkspaceSecurityResponse,
} from "./api";

interface CoursePasswordDialogProps {
  courseId: string;
  courseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordChanged?: (hasPassword: boolean) => void;
}

export function CoursePasswordDialog({
  courseId,
  courseName,
  open,
  onOpenChange,
  onPasswordChanged,
}: CoursePasswordDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [securityData, setSecurityData] = useState<CourseWorkspaceSecurityResponse | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [aliasName, setAliasName] = useState("");

  const loadSecurity = () => {
    if (!courseId) return;
    setLoading(true);
    getCourseWorkspaceSecurity(courseId)
      .then((data) => {
        setSecurityData(data);
        if (data.alias_name) setAliasName(data.alias_name);
      })
      .catch(() => setSecurityData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
      setOldPassword("");
      loadSecurity();
    }
  }, [open, courseId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      toast({ title: "请输入新密码", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "两次输入的密码不一致", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await setCourseWorkspacePassword(courseId, {
        password: password.trim(),
        old_password: oldPassword.trim() || undefined,
        alias_name: aliasName.trim() || undefined,
      });
      setSecurityData(res);
      toast({ title: "工作区密码设置成功", description: "其它用户无法查看您的私有资料与学生数据" });
      onPasswordChanged?.(true);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "设置失败",
        description: err instanceof Error ? err.message : "请检查原密码是否正确",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await clearCourseWorkspacePassword(courseId);
      toast({ title: "已清除访问密码" });
      setSecurityData({ has_password: false, alias_name: aliasName, workspace_key: null });
      onPasswordChanged?.(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "清除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasPassword = securityData?.has_password ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <KeyRound size={18} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {courseName ? `课程密码设置 · ${courseName}` : "课程工作区密码设置"}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                每个用户可以为当前课程设置独立密码，其它用户看不到您的密码和私有数据。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" />
            正在读取安全状态...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4 py-1">
            <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/40 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                {hasPassword ? (
                  <ShieldCheck size={16} className="text-emerald-500" />
                ) : (
                  <ShieldAlert size={16} className="text-amber-500" />
                )}
                <div>
                  <div className="font-medium text-foreground">
                    {hasPassword ? "当前工作区受密码保护" : "当前未设置访问密码"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {hasPassword
                      ? "重新进入该短链接时需凭密码解锁您的专属课程数据"
                      : "建议设置密码以保护自建资料、题目和班级考绩"}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="ws-alias" className="text-xs">
                  工作区署名 / 教师姓名（可选）
                </Label>
                <Input
                  id="ws-alias"
                  placeholder="例如：张老师 或 我的工作区"
                  className="mt-1.5 h-8 text-xs"
                  value={aliasName}
                  onChange={(e) => setAliasName(e.target.value)}
                />
              </div>

              {hasPassword ? (
                <div>
                  <Label htmlFor="ws-old-pwd" className="text-xs">
                    原密码
                  </Label>
                  <Input
                    id="ws-old-pwd"
                    type="password"
                    placeholder="若修改密码请输入原密码"
                    className="mt-1.5 h-8 text-xs"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                  />
                </div>
              ) : null}

              <div>
                <Label htmlFor="ws-new-pwd" className="text-xs">
                  {hasPassword ? "新密码" : "访问密码"}
                </Label>
                <Input
                  id="ws-new-pwd"
                  type="password"
                  placeholder="请输入访问密码"
                  className="mt-1.5 h-8 text-xs"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ws-confirm-pwd" className="text-xs">
                  确认密码
                </Label>
                <Input
                  id="ws-confirm-pwd"
                  type="password"
                  placeholder="请再次输入新密码"
                  className="mt-1.5 h-8 text-xs"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
              {hasPassword ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 text-xs"
                  disabled={saving}
                  onClick={handleClear}
                >
                  <Unlock size={13} className="mr-1" />
                  取消密码
                </Button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs gap-1.5" disabled={saving}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                  {hasPassword ? "更新密码" : "保存密码"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
