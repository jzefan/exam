import { useForm } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export function UserCreate() {
  const navigate = useNavigate();
  const { onFinish, formLoading } = useForm({
    resource: "users",
    action: "create",
    redirect: "list",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    full_name: "",
    role: "student" as string,
  });

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onFinish(form);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        返回用户列表
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">添加用户</h1>
        <p className="mt-1 text-sm text-muted-foreground">创建一个新的系统用户账号</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">用户信息</CardTitle>
          <CardDescription>请填写以下信息以创建新用户。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>用户名</Label>
                <Input
                  type="text"
                  placeholder="例如 zhangsan"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>姓名</Label>
                <Input
                  type="text"
                  placeholder="例如 张三"
                  value={form.full_name}
                  onChange={(e) => updateField("full_name", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>邮箱</Label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>密码</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  className="pr-10"
                  placeholder="请设置密码"
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

            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={form.role} onValueChange={(value) => updateField("role", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">学生</SelectItem>
                  <SelectItem value="teacher">教师</SelectItem>
                  <SelectItem value="school_admin">学校管理员</SelectItem>
                  <SelectItem value="enterprise_user">企业用户</SelectItem>
                  <SelectItem value="enterprise_admin">企业管理员</SelectItem>
                  <SelectItem value="platform_admin">平台管理员</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                角色决定用户在系统中的访问权限。
              </p>
            </div>

            <Separator />

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={formLoading}>
                {formLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    创建中...
                  </span>
                ) : (
                  "创建用户"
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                取消
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
