import { useTable, useNavigation, useDelete } from "@refinedev/core";
import type { IUser } from "../../../types";
import { getUserRole } from "@/types/rbac";
import {
  Pencil,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const roleLabel: Record<string, string> = {
  platform_admin: "平台管理员",
  enterprise_admin: "企业管理员",
  enterprise_user: "企业用户",
  school_admin: "学校管理员",
  teacher: "教师",
  student: "学生",
};

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline" | "success" | "warning" | "destructive"> = {
  platform_admin: "default",
  enterprise_admin: "default",
  enterprise_user: "secondary",
  school_admin: "default",
  teacher: "secondary",
  student: "outline",
};

const domainLabel: Record<IUser["system_domain"], string> = {
  platform: "平台",
  exam: "考试系统",
  job_model: "岗位模型",
}

function describeUser(user: IUser): string {
  const role = getUserRole(user)
  if (role === "student") {
    return user.teacher_names.length > 0 ? `关联教师：${user.teacher_names.join("、")}` : "未关联教师"
  }
  if (role === "teacher") {
    return `管理 ${user.managed_student_count} 名学生`
  }
  if (role === "platform_admin") {
    return "平台级账号"
  }
  if (user.system_domain === "job_model") {
    return "岗位模型账号"
  }
  return "独立账号"
}

function scopeLabel(user: IUser): string {
  if (user.system_domain === "platform") return "平台"
  if (user.system_domain === "exam") return "独立教师/学生域"
  return user.primary_org?.org_name || "岗位模型域"
}

export function UserList() {
  const {
    tableQuery: { data, isLoading },
    currentPage: current,
    setCurrentPage: setCurrent,
    pageSize,
    pageCount,
    setFilters,
  } = useTable<IUser>({
    resource: "users",
    pagination: { currentPage: 1, pageSize: 10 },
    sorters: { initial: [{ field: "created_at", order: "desc" }] },
    syncWithLocation: false,
  });

  const { create, edit } = useNavigation();
  const { mutate: deleteUser } = useDelete();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const users = data?.data ?? [];
  const total = data?.total ?? 0;

  useEffect(() => {
    const filters: Array<{ field: string; operator: "contains" | "eq"; value: string }> = [];

    if (search.trim()) {
      filters.push({ field: "username", operator: "contains", value: search.trim() });
    }
    if (roleFilter !== "all") {
      filters.push({ field: "role_name", operator: "eq", value: roleFilter });
    }

    setCurrent(1);
    setFilters(filters, "replace");
  }, [roleFilter, search, setCurrent, setFilters]);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteUser({ resource: "users", id: deleteTarget });
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-foreground tracking-tight">用户管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理系统用户账号与权限</p>
        </div>
        <Button onClick={() => create("users")}>
          <UserPlus size={16} />
          添加用户
        </Button>
      </div>

      <Card>
        <div className="p-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="搜索用户..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="全部角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部角色</SelectItem>
              {Object.entries(roleLabel).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground">
            共 {total} 位用户
          </div>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>系统域</TableHead>
                <TableHead>业务归属</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right pr-4">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-sm text-muted-foreground">
                    <span className="inline-block h-5 w-5 border-2 border-border border-t-foreground rounded-full animate-spin mr-2 align-middle" />
                    加载中...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Users size={40} className="mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">暂无用户数据</p>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const initials = user.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-gradient-to-br from-zinc-200 to-zinc-300 text-xs font-semibold text-zinc-600 dark:from-zinc-700 dark:to-zinc-600 dark:text-zinc-300">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {user.username}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {user.full_name}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={roleBadgeVariant[getUserRole(user)] ?? "outline"}>
                          {roleLabel[getUserRole(user)] ?? getUserRole(user)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline">{domainLabel[user.system_domain]}</Badge>
                          <p className="text-xs text-muted-foreground">{scopeLabel(user)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {describeUser(user)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              user.is_active ? "bg-emerald-500" : "bg-muted-foreground"
                            }`}
                          />
                          <span className="text-sm text-muted-foreground">
                            {user.is_active ? "正常" : "已禁用"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => edit("users", user.id)}
                            title="编辑"
                          >
                            <Pencil size={14} className="text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(user.id)}
                            title="删除"
                          >
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-sm text-muted-foreground">
              显示 {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} 条，共 {total} 条
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrent(current - 1)}
                disabled={current <= 1}
              >
                <ChevronLeft size={16} />
              </Button>
              {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => i + 1).map(
                (page) => (
                  <Button
                    key={page}
                    variant={page === current ? "default" : "ghost"}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setCurrent(page)}
                  >
                    {page}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrent(current + 1)}
                disabled={current >= pageCount}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除该用户吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
