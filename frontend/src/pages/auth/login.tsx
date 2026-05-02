import { useLogin } from "@refinedev/core";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
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
import { AuthHeader, AuthShell } from "./auth-shell";
import { SlideToLogin } from "./slide-to-login";

type ForgotPasswordResult = {
  status: "email_sent" | "contact_admin";
  message: string;
  email: string | null;
};

type LoginCredentials = {
  username: string;
  password: string;
};

export function LoginPage() {
  const { mutate: login, isPending } = useLogin<LoginCredentials>();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: "", password: "" });
  const [slideError, setSlideError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotAccount, setForgotAccount] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState<ForgotPasswordResult | null>(null);
  const [forgotSentAccount, setForgotSentAccount] = useState("");
  const [forgotError, setForgotError] = useState("");

  const hasSentResetLinkForCurrentAccount =
    forgotResult?.status === "email_sent" && forgotAccount.trim() === forgotSentAccount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSlideError("请向右滑动完成登录");
  };

  const handleSlideComplete = () => {
    setSlideError("");
    if (!formRef.current?.reportValidity()) {
      return false;
    }
    login(
      { username: form.username, password: form.password },
      {
        onSuccess: (result) => {
          if (!result.success) {
            setSlideError(result.error?.message || "登录失败，请检查账号和密码后重试");
          }
        },
        onError: (error) => {
          setSlideError(error.message || "登录服务暂时不可用，请稍后重试");
        },
      },
    );
    return true;
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSlideError("");
  };

  const submitForgotPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const account = forgotAccount.trim();
    if (hasSentResetLinkForCurrentAccount) {
      return;
    }
    setForgotResult(null);
    setForgotError("");
    setForgotSentAccount("");
    if (!account) {
      setForgotError("请输入用户名、手机号或邮箱");
      return;
    }
    setForgotLoading(true);
    try {
      const { data } = await axios.post<ForgotPasswordResult>("/api/auth/forgot-password", {
        account,
      });
      setForgotResult(data);
      setForgotSentAccount(data.status === "email_sent" ? account : "");
    } catch (error) {
      setForgotSentAccount("");
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setForgotError(error.response.data?.detail || "未找到对应账号，请检查后重试");
      } else if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
        setForgotError(error.response.data.detail);
      } else {
        setForgotError("暂时无法处理找回密码请求，请稍后重试");
      }
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthHeader
        title="欢迎回来"
        subtitle="适用于高校考试与职业认证场景"
      />

      <form ref={formRef} onSubmit={handleSubmit} className="auth-fields">
        <div className="auth-field">
          <Label htmlFor="login-username">用户名</Label>
          <Input
            id="login-username"
            type="text"
            placeholder="请输入用户名"
            autoComplete="username"
            value={form.username}
            onChange={(e) => updateField("username", e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="auth-field">
          <div className="auth-field-label-row">
            <Label htmlFor="login-password">密码</Label>
            <button
              type="button"
              className="auth-inline-action"
              onClick={() => {
                setForgotAccount(form.username);
                setForgotResult(null);
                setForgotSentAccount("");
                setForgotError("");
                setForgotOpen(true);
              }}
            >
              忘记密码？
            </button>
          </div>
          <div className="auth-input-wrap">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              className="auth-input-with-suffix"
              placeholder="请输入密码"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="auth-input-suffix"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </div>

        <SlideToLogin
          loading={isPending}
          onComplete={handleSlideComplete}
          resetKey={`${form.username}:${form.password}`}
        />
        {slideError && <p className="auth-error-text">{slideError}</p>}
      </form>

      <p className="auth-switch">
        没有账号？{" "}
        <Link to="/register">
          立即注册
        </Link>
      </p>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>找回密码</DialogTitle>
            <DialogDescription>
              输入注册时使用的用户名、手机号或邮箱，系统会向绑定邮箱发送密码重置链接。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForgotPassword} className="flex flex-col gap-4">
            <div className="auth-field">
              <Label htmlFor="forgot-account">账号</Label>
              <Input
                id="forgot-account"
                value={forgotAccount}
                onChange={(event) => {
                  setForgotAccount(event.target.value);
                  setForgotResult(null);
                  setForgotSentAccount("");
                  setForgotError("");
                }}
                placeholder="请输入用户名、手机号或邮箱"
                autoComplete="username"
                autoFocus
              />
            </div>
            {forgotResult && (
              <div className="auth-recovery-result">
                <p>{forgotResult.message}</p>
                {forgotResult.email && <span>绑定邮箱：{forgotResult.email}</span>}
              </div>
            )}
            {forgotError && <p className="auth-error-text">{forgotError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setForgotOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={forgotLoading || hasSentResetLinkForCurrentAccount}>
                {forgotLoading ? "发送中..." : hasSentResetLinkForCurrentAccount ? "已发送，请查收邮箱" : "发送重置链接"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}
