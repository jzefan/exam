import { useRegister } from "@refinedev/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Eye, EyeOff, Monitor, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AuthHeader, AuthShell } from "./auth-shell";

type PasswordStrength = 0 | 1 | 2 | 3;

export function RegisterPage() {
  const { mutate: register, isPending } = useRegister();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    persona: "teacher",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");

  const getPasswordStrength = (value: string): PasswordStrength => {
    if (!value) return 0;
    let score = 0;
    if (value.length >= 6) score += 1;
    if (/[A-Z]/.test(value) || /[^a-zA-Z0-9]/.test(value)) score += 1;
    if (value.length >= 10 && /\d/.test(value)) score += 1;
    return Math.min(score, 3) as PasswordStrength;
  };

  const passwordStrength = getPasswordStrength(form.password);
  const strengthLabel = ["", "弱", "中", "强"][passwordStrength];
  const personaOptions = [
    {
      value: "teacher",
      title: "教学考试",
      desc: "管理学生、班级、考试与阅卷",
      icon: Users,
    },
    {
      value: "assessor",
      title: "通用测评",
      desc: "管理考生、部门、测评与阅卷",
      icon: Monitor,
    },
  ];

  const validatePassword = (value: string) => {
    if (!value) {
      return "请输入密码";
    }
    if (value.length < 6) {
      return "密码至少需要 6 个字符";
    }
    return "";
  };

  const validateConfirmPassword = (value: string, password = form.password) => {
    if (!value) {
      return "";
    }
    if (password !== value) {
      return "两次输入的密码不一致";
    }
    return "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const nextPasswordError = validatePassword(form.password);
    const nextConfirmPasswordError = validateConfirmPassword(form.confirmPassword);
    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmPasswordError);
    if (nextConfirmPasswordError) {
      return;
    }
    if (nextPasswordError) {
      return;
    }
    register({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      full_name: form.username.trim(),
      role_name: "evaluator",
      persona: form.persona,
    });
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "password" && confirmPasswordError) {
        setConfirmPasswordError(validateConfirmPassword(next.confirmPassword, value));
      }
      if (field === "confirmPassword" && confirmPasswordError) {
        setConfirmPasswordError(validateConfirmPassword(value, next.password));
      }
      return next;
    });
  };

  return (
    <AuthShell cardClassName="auth-card-register">
      <AuthHeader
        title="创建账号"
        subtitle="适用于高校师生、企业培训与职业认证"
      />

      {error && (
        <div className="auth-error-box">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-fields auth-register-form">
        <div className="auth-field auth-field-span-2">
          <Label>账号用途</Label>
          <div className="auth-persona-grid">
            {personaOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "auth-persona-card",
                    form.persona === option.value && "auth-persona-card-active",
                  )}
                >
                  <input
                    type="radio"
                    name="persona"
                    value={option.value}
                    checked={form.persona === option.value}
                    onChange={(event) => updateField("persona", event.target.value)}
                  />
                  <span className="auth-persona-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="auth-persona-body">
                    <span className="auth-persona-title">{option.title}</span>
                    <span className="auth-persona-desc">{option.desc}</span>
                  </span>
                  <span className="auth-persona-check" aria-hidden="true">
                    <Check />
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="auth-field auth-field-span-2">
          <Label htmlFor="register-username">用户名</Label>
          <Input
            id="register-username"
            type="text"
            placeholder="请设置登录用户名"
            autoComplete="username"
            value={form.username}
            onChange={(e) => updateField("username", e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="auth-field auth-field-span-2">
          <Label htmlFor="register-email">邮箱</Label>
          <Input
            id="register-email"
            type="email"
            placeholder="请输入邮箱，用于后续找回密码"
            autoComplete="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
          />
        </div>

        <div className="auth-field">
          <Label htmlFor="register-password">密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="register-password"
              type={showPassword ? "text" : "password"}
              className="auth-input-with-suffix"
              placeholder="请输入密码（至少6位）"
              autoComplete="new-password"
              value={form.password}
              onBlur={(e) => setPasswordError(validatePassword(e.target.value))}
              onChange={(e) => {
                updateField("password", e.target.value);
                if (passwordError) {
                  setPasswordError(validatePassword(e.target.value));
                }
              }}
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
          <div className="auth-strength" aria-hidden={!form.password}>
            {[1, 2, 3].map((level) => (
              <span
                key={level}
                className={cn(
                  passwordStrength >= level && passwordStrength === 1 && "auth-strength-weak",
                  passwordStrength >= level && passwordStrength === 2 && "auth-strength-medium",
                  passwordStrength >= level && passwordStrength === 3 && "auth-strength-strong",
                )}
              />
            ))}
          </div>
          {form.password && (
            <p className="auth-strength-hint">强度：{strengthLabel}</p>
          )}
          {passwordError && <p className="auth-error-text">{passwordError}</p>}
        </div>

        <div className="auth-field">
          <Label htmlFor="register-confirm-password">确认密码</Label>
          <div className="auth-input-wrap">
            <Input
              id="register-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              className="auth-input-with-suffix"
              placeholder="再次输入密码"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              onBlur={(e) => setConfirmPasswordError(validateConfirmPassword(e.target.value))}
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
          {confirmPasswordError && <p className="auth-error-text">{confirmPasswordError}</p>}
        </div>

        <Button type="submit" className="auth-submit auth-register-submit auth-field-span-2" disabled={isPending}>
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="auth-submit-spinner" />
              注册中...
            </span>
          ) : (
            "注册"
          )}
        </Button>
      </form>

      <p className="auth-switch">
        已有账号？{" "}
        <Link to="/login">
          去登录
        </Link>
      </p>
    </AuthShell>
  );
}
