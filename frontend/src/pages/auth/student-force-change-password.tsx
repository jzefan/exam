import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IUser } from "@/types";
import { notifyAuthChanged } from "@/lib/active-user";
import { AuthHeader, AuthShell } from "./auth-shell";

interface ForceChangePasswordResponse {
  message: string;
  user: IUser;
}

export function StudentForceChangePasswordPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("密码至少需要6位");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    const token = localStorage.getItem("access_token");
    setSubmitting(true);
    try {
      const { data } = await axios.post<ForceChangePasswordResponse>(
        "/api/auth/force-change-password",
        { password, confirm_password: confirmPassword },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate("/student", { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || "密码修改失败，请稍后重试");
      } else {
        setError("密码修改失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <AuthHeader title="设置新密码" subtitle="首次登录需要修改初始密码" />

      <form onSubmit={handleSubmit} className="auth-fields">
        <div className="auth-field">
          <Label htmlFor="force-password">新密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="force-password"
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
          <Label htmlFor="force-confirm-password">确认密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="force-confirm-password"
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

        <Button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "修改中..." : "确认修改"}
        </Button>
      </form>

      <p className="auth-switch">
        <button
          type="button"
          className="auth-inline-action"
          onClick={() => {
            localStorage.removeItem("access_token");
            localStorage.removeItem("user");
            notifyAuthChanged();
            navigate("/login", { replace: true });
          }}
        >
          返回登录
        </button>
      </p>
    </AuthShell>
  );
}
