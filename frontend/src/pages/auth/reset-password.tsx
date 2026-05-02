import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthHeader, AuthShell } from "./auth-shell";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!token) {
      setError("重置链接缺少令牌，请重新发起找回密码。");
      return;
    }
    if (password.length < 6) {
      setError("密码至少需要6位");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await axios.post<{ message: string }>("/api/auth/reset-password", {
        token,
        password,
      });
      setSuccess(data.message || "密码已重置，请使用新密码登录");
      setPassword("");
      setConfirmPassword("");
      navigate("/login", { replace: true });
    } catch (resetError) {
      if (axios.isAxiosError(resetError)) {
        setError(resetError.response?.data?.detail || "重置密码失败，请重新获取链接");
      } else {
        setError("重置密码失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <AuthHeader title="重置密码" subtitle="请输入新密码完成账号恢复" />

      <form onSubmit={handleSubmit} className="auth-fields">
        <div className="auth-field">
          <Label htmlFor="reset-password">新密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="reset-password"
              type={showPassword ? "text" : "password"}
              className="auth-input-with-suffix"
              placeholder="请输入新密码（至少6位）"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="auth-input-suffix"
              aria-label={showPassword ? "隐藏新密码" : "显示新密码"}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="auth-field">
          <Label htmlFor="reset-confirm-password">确认密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="reset-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              className="auth-input-with-suffix"
              placeholder="再次输入新密码"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError("");
              }}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="auth-input-suffix"
              aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}
            >
              {showConfirmPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </div>

        {error && <p className="auth-error-text">{error}</p>}
        {success && <div className="auth-recovery-result">{success}</div>}

        <Button type="submit" className="auth-submit" disabled={submitting || Boolean(success)}>
          {submitting ? "重置中..." : "重置密码"}
        </Button>
      </form>

      <p className="auth-switch">
        想起密码？ <Link to="/login">返回登录</Link>
      </p>
    </AuthShell>
  );
}
