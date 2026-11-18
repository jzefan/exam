import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useLogin, useLogout, useRegister } from "@refinedev/core";
import { BookOpen, FileText, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { ResourcePreview } from "@/pages/job-models/editor/resource-preview";
import { AUTH_CHANGED_EVENT } from "@/lib/active-user";
import {
  CourseWorkspaceContext,
  safeCourseReturnTo,
} from "@/lib/course-workspace";
import type { IUser } from "@/types";
import {
  enterCourseShare,
  getCourseShareContent,
  getCourseSharePublicPreview,
  type CourseSharePublicPreviewResponse,
  type PublicCourseContent,
  type TeacherCourseMaterial,
} from "./api";

function CourseAuthDialog({ register }: { register: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeCourseReturnTo(params.get("to"));
  const { mutate: login, isPending: loggingIn } = useLogin();
  const { mutate: signUp, isPending: registering } = useRegister();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
    full_name: "",
    email: "",
    confirm: "",
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (register && form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    const options = {
      onSuccess: (result: {
        success: boolean;
        error?: { message?: string };
      }) => {
        if (!result.success)
          setError(result.error?.message || "操作失败，请重试");
      },
      onError: (err: { message: string }) => setError(err.message),
    };
    if (register)
      signUp(
        {
          ...form,
          username: form.username.trim(),
          full_name: form.full_name.trim() || form.username.trim(),
          role_name: "teacher",
          persona: "teacher",
          redirectTo: returnTo,
        },
        options,
      );
    else
      login(
        {
          username: form.username.trim(),
          password: form.password,
          role_name: "teacher",
          redirectTo: returnTo,
        },
        options,
      );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) navigate("/", { replace: true });
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{register ? "注册教师账号" : "教师登录"}</DialogTitle>
          <DialogDescription>
            登录后可创建自己的学期、学生和教学内容。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-username">用户名</Label>
            <Input
              id="course-username"
              autoComplete="username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          {register && (
            <div className="space-y-2">
              <Label htmlFor="course-name">姓名</Label>
              <Input
                id="course-name"
                autoComplete="name"
                required
                value={form.full_name}
                onChange={(e) =>
                  setForm({ ...form, full_name: e.target.value })
                }
              />
            </div>
          )}
          {register && (
            <div className="space-y-2">
              <Label htmlFor="course-email">邮箱（选填）</Label>
              <Input
                id="course-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="course-password">密码</Label>
            <Input
              id="course-password"
              type="password"
              minLength={register ? 6 : undefined}
              autoComplete={register ? "new-password" : "current-password"}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {register && (
            <div className="space-y-2">
              <Label htmlFor="course-confirm">确认密码</Label>
              <Input
                id="course-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loggingIn || registering}
          >
            {(loggingIn || registering) && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            {register ? "注册并继续" : "登录并继续"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {register ? "已有账号？" : "还没有账号？"}
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={`${register ? "/login" : "/register"}?to=${encodeURIComponent(returnTo)}`}
            >
              {register ? "登录" : "注册教师账号"}
            </Link>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PublicPreview({
  preview,
  content,
}: {
  preview: CourseSharePublicPreviewResponse;
  content: PublicCourseContent | null;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [resource, setResource] = useState<TeacherCourseMaterial | null>(null);
  const selectedTab = params.get("tab") || "knowledge";
  const create = (path: string) =>
    navigate(`/login?to=${encodeURIComponent(path)}`);
  const coursePath = `/courses/${preview.course_id}`;
  const tree = (parent: string | null, depth = 0): ReactNode =>
    content?.knowledge_points
      .filter((kp) => kp.parent_id === parent)
      .map((kp) => (
        <li key={kp.id} className="space-y-2">
          <div className="border-b py-3">
            <p className="font-medium">{kp.name}</p>
            {kp.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {kp.description}
              </p>
            )}
          </div>
          {depth < 30 && <ul className="ml-5">{tree(kp.id, depth + 1)}</ul>}
        </li>
      ));
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{preview.course_name}</h1>
          {preview.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {preview.description}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            公开教学内容可直接预览，自建内容仅自己可见。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => create("/students")}
          >
            <Users className="mr-1.5 size-4" />
            管理学生
          </Button>
          <Button
            size="sm"
            onClick={() => create(`${coursePath}?tab=manage&create=semester`)}
          >
            创建学期
          </Button>
        </div>
      </div>
      <Tabs value={selectedTab} onValueChange={(tab) => setParams({ tab })}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="knowledge">知识目录</TabsTrigger>
          <TabsTrigger value="materials">
            资料 {preview.stats.material_count}
          </TabsTrigger>
          <TabsTrigger value="questions">
            题目 {preview.stats.question_count}
          </TabsTrigger>
          <TabsTrigger value="papers">
            试卷 {preview.stats.paper_count}
          </TabsTrigger>
          <TabsTrigger value="teaching">教学管理</TabsTrigger>
        </TabsList>
        {!content ? (
          <p className="py-8 text-sm text-muted-foreground">
            正在加载课程内容…
          </p>
        ) : (
          <>
            <TabsContent value="knowledge">
              <ul>{tree(null)}</ul>
            </TabsContent>
            <TabsContent value="materials" className="space-y-3">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => create(`${coursePath}?tab=materials`)}
                >
                  上传自己的资料
                </Button>
              </div>
              {content.materials.length === 0 && <Empty label="暂无公开资料" />}
              {content.materials.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center gap-3 rounded-md border p-4 text-left hover:bg-muted/50"
                  onClick={() => setResource(item)}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.node_name}
                    </span>
                  </span>
                  <span className="text-sm text-primary">预览</span>
                </button>
              ))}
            </TabsContent>
            <TabsContent value="questions" className="space-y-3">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() =>
                    create(
                      `/questions/create?knowledge_point_id=${preview.course_id}&course_id=${preview.course_id}`,
                    )
                  }
                >
                  添加自己的题目
                </Button>
              </div>
              {content.questions.length === 0 && <Empty label="暂无公开题目" />}
              {content.questions.map((q, i) => (
                <QuestionPreviewCard
                  key={q.id}
                  question={q}
                  index={i + 1}
                  defaultExpanded
                />
              ))}
            </TabsContent>
            <TabsContent value="papers" className="space-y-3">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => create(`${coursePath}/papers/create`)}
                >
                  创建自己的试卷
                </Button>
              </div>
              {content.papers.length === 0 && <Empty label="暂无公开试卷" />}
              {content.papers.map((paper) => (
                <details key={paper.id} className="rounded-md border p-4">
                  <summary className="cursor-pointer font-medium">
                    {paper.title}
                    <span className="ml-3 text-xs font-normal text-muted-foreground">
                      {paper.question_count} 题 · {paper.total_score} 分
                    </span>
                  </summary>
                  <div className="mt-4 space-y-3">
                    {paper.description && (
                      <p className="text-sm text-muted-foreground">
                        {paper.description}
                      </p>
                    )}
                    {paper.questions.map(
                      (item, i) =>
                        item.question && (
                          <QuestionPreviewCard
                            key={item.question_id}
                            question={item.question}
                            index={i + 1}
                            defaultExpanded
                            scoreOverride={item.score_override}
                          />
                        ),
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => create(`/papers/${paper.id}`)}
                    >
                      使用这份试卷
                    </Button>
                  </div>
                </details>
              ))}
            </TabsContent>
            <TabsContent value="teaching">
              <div className="space-y-4 py-6">
                <p className="text-sm text-muted-foreground">
                  登录教师账号后，在本课程内管理自己的教学。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      create(`${coursePath}?tab=manage&create=semester`)
                    }
                  >
                    创建学期
                  </Button>
                  <Button variant="outline" onClick={() => create("/students")}>
                    管理学生
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      create(
                        `/exams/practice/create?course_kp_id=${preview.course_id}`,
                      )
                    }
                  >
                    发布练习
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      create(`/exams/create?course_kp_id=${preview.course_id}`)
                    }
                  >
                    发布考试
                  </Button>
                </div>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
      <ResourcePreview
        resource={resource}
        open={!!resource}
        onOpenChange={(open) => {
          if (!open) setResource(null);
        }}
      />
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">{label}</p>
  );
}

export function CourseWorkspaceShell({
  shareCode,
  children,
}: {
  shareCode: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { mutate: logout } = useLogout();
  const [redirectAnonymous, setRedirectAnonymous] = useState(true);
  const leaveSession = () => {
    setRedirectAnonymous(false);
    navigate("/", { replace: true });
    logout({ redirectPath: false });
  };
  const [token, setToken] = useState(() =>
    localStorage.getItem("access_token"),
  );
  const [preview, setPreview] =
    useState<CourseSharePublicPreviewResponse | null>(null);
  const [content, setContent] = useState<PublicCourseContent | null>(null);
  const [member, setMember] = useState<{ token: string; user: IUser } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [joinError, setJoinError] = useState("");
  const authPage =
    location.pathname === "/login" || location.pathname === "/register";
  useEffect(() => {
    const sync = () => {
      setToken(localStorage.getItem("access_token"));
      setMember(null);
      setJoinError("");
    };
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      getCourseSharePublicPreview(shareCode),
      getCourseShareContent(shareCode),
    ])
      .then(([info, data]) => {
        if (active) {
          setPreview(info);
          setContent(data);
        }
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [shareCode]);
  useEffect(() => {
    if (!token) return;
    setRedirectAnonymous(true);
    let active = true;
    enterCourseShare(shareCode)
      .then((result) => {
        if (active && result.user) {
          localStorage.setItem("user", JSON.stringify(result.user));
          setMember({ token, user: result.user });
        }
      })
      .catch((err: Error) => {
        if (active) setJoinError(err.message);
      });
    return () => {
      active = false;
    };
  }, [shareCode, token]);
  if (error)
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-lg font-semibold">课程链接不可用</h1>
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          {error}
        </p>
      </div>
    );
  if (!preview)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 aria-label="加载课程" className="size-5 animate-spin" />
      </div>
    );
  const authenticated = !!token && member?.token === token;
  return (
    <CourseWorkspaceContext.Provider
      value={{
        courseId: preview.course_id,
        courseName: preview.course_name,
        shareCode,
      }}
    >
      <div className="min-h-screen bg-background">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 text-sm font-medium"
          >
            <BookOpen className="size-4 shrink-0" />
            <span className="truncate">{preview.course_name}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {authenticated ? (
              <>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/students">学生</Link>
                </Button>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {member.user.full_name}
                </span>
                <Button size="sm" variant="ghost" onClick={leaveSession}>
                  退出登录
                </Button>
              </>
            ) : token ? (
              <Button size="sm" variant="outline" onClick={leaveSession}>
                切换账号
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/login">登录</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/register">注册</Link>
                </Button>
              </>
            )}
          </div>
        </header>
        {joinError && (
          <p
            role="alert"
            className="border-b px-6 py-3 text-sm text-destructive"
          >
            {joinError}
          </p>
        )}
        {authenticated && !authPage ? (
          <div
            key={member.user.id}
            className="mx-auto max-w-screen-2xl p-4 sm:p-6"
          >
            {children}
          </div>
        ) : (
          <PublicPreview preview={preview} content={content} />
        )}
        {authPage && (!token || joinError) && (
          <CourseAuthDialog
            key={location.pathname}
            register={location.pathname === "/register"}
          />
        )}
        {authenticated && authPage && (
          <Navigate
            to={safeCourseReturnTo(
              new URLSearchParams(location.search).get("to"),
            )}
            replace
          />
        )}
        {redirectAnonymous &&
          !token &&
          !authPage &&
          location.pathname !== "/" && (
            <Navigate
              to={`/login?to=${encodeURIComponent(location.pathname + location.search)}`}
              replace
            />
          )}
      </div>
    </CourseWorkspaceContext.Provider>
  );
}
