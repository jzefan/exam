import { useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { IUser } from "../../../types";
import { getUserRole } from "@/types/rbac";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { result: user, query } = useOne<IUser>({ resource: "users", id: id! });
  const { mutate, mutation } = useUpdate();
  const updateLoading = mutation.isPending;

  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "student" as string,
    is_active: true,
  });

  useEffect(() => {
    if (user) {
      setForm({
        email: user.email,
        full_name: user.full_name,
        role: getUserRole(user),
        is_active: user.is_active,
      });
    }
  }, [user]);

  const updateField = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutate(
      { resource: "users", id: id!, values: form },
      { onSuccess: () => navigate("/users") },
    );
  };

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const initials = (user?.full_name ?? "")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        返回用户列表
      </button>

      <div className="flex items-center gap-4 mb-6">
        <Avatar className="h-12 w-12">
          <AvatarFallback className="bg-gradient-to-br from-zinc-200 to-zinc-300 text-base font-semibold text-zinc-600 dark:from-zinc-700 dark:to-zinc-600 dark:text-zinc-300">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">编辑用户</h1>
          <p className="text-sm text-muted-foreground">@{user?.username}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号信息</CardTitle>
          <CardDescription>修改用户的基本信息和权限设置。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label>用户名</Label>
              <Input
                type="text"
                value={user?.username ?? ""}
                disabled
              />
              <p className="text-xs text-muted-foreground">用户名创建后不可修改。</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>姓名</Label>
                <Input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => updateField("full_name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>邮箱</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  required
                />
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
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted border border-border">
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => updateField("is_active", checked)}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  账号{form.is_active ? "已启用" : "已禁用"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {form.is_active
                    ? "用户可以正常登录和使用系统"
                    : "用户将无法登录系统"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={updateLoading}>
                {updateLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    保存中...
                  </span>
                ) : (
                  "保存修改"
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
