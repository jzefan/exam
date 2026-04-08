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
import { useState } from "react";
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

  const users = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleSearch = (value: string) => {
    setSearch(value);
    setFilters([{ field: "username", operator: "contains", value }]);
  };

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
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
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
                <TableHead>状态</TableHead>
                <TableHead className="text-right pr-4">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground">
                    <span className="inline-block h-5 w-5 border-2 border-border border-t-foreground rounded-full animate-spin mr-2 align-middle" />
                    加载中...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
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
