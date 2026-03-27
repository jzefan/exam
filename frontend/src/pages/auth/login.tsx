import { useLogin } from "@refinedev/core";
import { useState } from "react";
import { GraduationCap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const { mutate: login, isPending } = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: "", password: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ username: form.username, password: form.password });
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
          <span className="text-lg font-bold text-foreground">智评云</span>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            欢迎回来
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            请输入您的账号信息登录系统
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>用户名</Label>
            <Input
              type="text"
              placeholder="请输入用户名"
              value={form.username}
              onChange={(e) => updateField("username", e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>密码</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                className="pr-10"
                placeholder="请输入密码"
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
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
          </div>

          <Button type="submit" className="w-full mt-2" disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                登录中...
              </span>
            ) : (
              "登录"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
