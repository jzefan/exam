import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Users, NotebookPen, Settings, Smartphone } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPersonaCopy } from "@/lib/persona-copy";
import { canManageStudents, canManageUsers } from "@/utils/role-routing";

export function UserDropdown({
  name,
  role,
  persona,
  onLogout,
}: {
  name: string;
  role?: string;
  persona?: string | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const installed = window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const copy = getPersonaCopy(persona);
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-1.5 px-2 py-1.5 h-auto">
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
              {copy.management}
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
          {role === "teacher" && !installed && (
            <DropdownMenuItem className="md:hidden" onSelect={() => setInstallHelpOpen(true)}>
              <Smartphone size={14} className="mr-2" />
              添加到主屏幕
            </DropdownMenuItem>
          )}
          {role === "teacher" && !installed && <DropdownMenuSeparator className="md:hidden" />}
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
      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-5">
          <DialogHeader>
            <DialogTitle>添加到主屏幕</DialogTitle>
            <DialogDescription>安装后可从桌面直接打开智评线。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-6">
            <p><strong>iPhone Safari：</strong>点击底部「分享」图标，选择「添加到主屏幕」即可。</p>
            <p><strong>Android Chrome：</strong>点右上角菜单，再选“安装应用”或“添加到主屏幕”。</p>
            <p className="text-muted-foreground">首次从桌面打开时，可能需要重新登录。</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
