import { useNavigate } from "react-router-dom";
import { LogOut, Users, NotebookPen, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { canManageStudents, canManageUsers } from "@/utils/role-routing";

export function UserDropdown({
  name,
  role,
  onLogout,
}: {
  name: string;
  role?: string;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 px-2 py-1.5 h-auto">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium text-foreground max-w-[120px] truncate hidden sm:inline">
            {name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canManageStudents(role ?? "") && (
          <DropdownMenuItem onClick={() => navigate("/students")}>
            <Users size={14} className="mr-2" />
            学生管理
          </DropdownMenuItem>
        )}
        {canManageStudents(role ?? "") && <DropdownMenuSeparator />}
        {canManageUsers(role ?? "") && (
          <DropdownMenuItem onClick={() => navigate("/users")}>
            <Users size={14} className="mr-2" />
            用户管理
          </DropdownMenuItem>
        )}
        {canManageUsers(role ?? "") && <DropdownMenuSeparator />}
        {role !== "student" && (
          <DropdownMenuItem onClick={() => navigate("/settings/model")}>
            <Settings size={14} className="mr-2" />
            模型设置
          </DropdownMenuItem>
        )}
        {role !== "student" && <DropdownMenuSeparator />}
        {role === "student" && (
          <DropdownMenuItem onClick={() => navigate("/wrong-answers")}>
            <NotebookPen size={14} />
            错题本
          </DropdownMenuItem>
        )}
        {role === "student" && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={onLogout}
          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          <LogOut size={14} />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
