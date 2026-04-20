import { useRegister } from "@refinedev/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBrand } from "@/lib/brand";

export function RegisterPage() {
  const { mutate: register, isPending } = useRegister();
  const brand = useBrand();
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    full_name: "",
  });
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const validatePassword = (value: string) => {
    if (!value) {
      return "请输入密码";
    }
    if (value.length < 6) {
      return "密码至少需要 6 个字符";
    }
    return "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const nextPasswordError = validatePassword(form.password);
    setPasswordError(nextPasswordError);
    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (nextPasswordError) {
      return;
    }
    register({
      username: form.username,
      email: form.email.trim(),
      password: form.password,
      full_name: form.full_name,
      role_name: "teacher",
    });
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-6">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
            <GraduationCap size={18} className="text-white" />
          </div>
          <span className="text-lg font-bold text-foreground">{brand.name}</span>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-base font-bold text-foreground tracking-tight">创建账号</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">注册教师账号开始使用</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>姓名</Label>
            <Input
              type="text"
              placeholder="请输入姓名"
              value={form.full_name}
              onChange={(e) => updateField("full_name", e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>用户名</Label>
            <Input
              type="text"
              placeholder="请输入用户名"
              value={form.username}
              onChange={(e) => updateField("username", e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>邮箱</Label>
            <Input
              type="email"
              placeholder="请输入邮箱（选填）"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>密码</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                className="pr-10"
                placeholder="请输入密码（至少6位）"
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
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>确认密码</Label>
            <Input
              type="password"
              placeholder="再次输入密码"
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full mt-2" disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                注册中...
              </span>
            ) : (
              "注册"
            )}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  );
}
