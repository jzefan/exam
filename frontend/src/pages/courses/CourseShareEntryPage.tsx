import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BookOpen, KeyRound, Loader2, Lock, PlusCircle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  enterCourseShare,
  getCourseSharePublicPreview,
  type CourseSharePublicPreviewResponse,
} from "./api";

export function CourseShareEntryPage() {
  const { shareCode } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CourseSharePublicPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [aliasName, setAliasName] = useState<string | null>(null);

  const storageKey = shareCode ? `course_ws_${shareCode}` : "";

  const performEnter = async (pwd?: string, ignoreSavedWs: boolean = false) => {
    if (!shareCode) return;
    const savedWsKey = !ignoreSavedWs && storageKey ? localStorage.getItem(storageKey) || undefined : undefined;

    try {
      const res = await enterCourseShare(shareCode, {
        workspace_key: savedWsKey,
        password: pwd,
      });

      if (res.requires_password) {
        setRequiresPassword(true);
        setAliasName(res.alias_name);
        setLoading(false);
        return;
      }

      if (res.access_token) {
        localStorage.setItem("access_token", res.access_token);
        if (res.user) {
          localStorage.setItem("user", JSON.stringify(res.user));
        }
        if (res.workspace_key && storageKey) {
          localStorage.setItem(storageKey, res.workspace_key);
        }
        // Direct entry: go straight to the course!
        navigate(`/courses/${res.course_id}`, { replace: true });
      }
    } catch (err) {
      if (pwd) {
        toast({
          title: "密码错误",
          description: "请输入正确的访问密码以解锁您的工作区",
          variant: "destructive",
        });
      } else {
        setError(err instanceof Error ? err.message : "无法直接进入课程，请检查链接是否有效");
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!shareCode) {
      setError("未提供课程短链接识别码");
      setLoading(false);
      return;
    }

    let active = true;
    getCourseSharePublicPreview(shareCode)
      .then((data) => {
        if (!active) return;
        setPreview(data);
        // Automatically attempt entry
        void performEnter();
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "课程短链接不存在或已停用");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [shareCode]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      toast({ title: "请输入访问密码", variant: "destructive" });
      return;
    }
    setSubmittingPassword(true);
    try {
      await performEnter(password.trim());
    } finally {
      setSubmittingPassword(false);
    }
  };

  const handleCreateFreshWorkspace = () => {
    setRequiresPassword(false);
    setPassword("");
    setLoading(true);
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
    void performEnter(undefined, true);
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/20">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
              <ShieldAlert size={24} />
            </div>
            <CardTitle className="text-lg">无法进入课程</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">{error}</CardDescription>
          </CardHeader>
          <CardFooter className="flex justify-center">
            <Button size="sm" variant="outline" onClick={() => navigate("/login")}>
              返回登录页
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (requiresPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/20">
        <Card className="w-full max-w-md shadow-sm border-border">
          <CardHeader className="text-center pb-3">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
              <Lock size={20} />
            </div>
            <CardTitle className="text-base font-semibold">
              {preview?.course_name ? `进入「${preview.course_name}」` : "解锁课程工作区"}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {aliasName ? `检测到已有署名「${aliasName}」的工作区，请输入访问密码。` : "该工作区已设置访问密码，请输入密码进入。"}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handlePasswordSubmit}>
            <CardContent className="space-y-3 pb-4">
              <div className="space-y-1.5">
                <Label htmlFor="course-pwd" className="text-xs">
                  访问密码
                </Label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="course-pwd"
                    type="password"
                    autoFocus
                    placeholder="请输入该课程工作区的访问密码"
                    className="h-9 pl-8 text-xs"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 pt-0">
              <Button type="submit" size="sm" className="w-full h-9 text-xs" disabled={submittingPassword}>
                {submittingPassword ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Lock size={14} className="mr-1.5" />}
                验证密码并进入
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground hover:text-foreground h-8"
                onClick={handleCreateFreshWorkspace}
              >
                <PlusCircle size={13} className="mr-1.5" />
                忘记密码？创建新的访客工作区
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/20">
      <Card className="w-full max-w-sm text-center border-border shadow-sm p-6">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
          <BookOpen size={22} />
        </div>
        <h3 className="font-semibold text-base text-foreground">
          {preview?.course_name ? preview.course_name : "正在进入课程"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {loading ? "正在为您初始化专属工作区，即将直接进入..." : "正在跳转..."}
        </p>
        <div className="mt-5 flex justify-center">
          <Loader2 size={20} className="animate-spin text-primary" />
        </div>
      </Card>
    </div>
  );
}

export default CourseShareEntryPage;
