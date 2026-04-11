import { useEffect, useState } from "react";
import { useLogout, useGetIdentity } from "@refinedev/core";
import { Link, NavLink, Outlet } from "react-router-dom";
import axios from "axios";
import { GraduationCap, Home, ClipboardList, NotebookPen, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeCustomizer } from "./theme-customizer";
import { cn } from "@/lib/utils";
import type { IStudentNotification } from "@/types";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const navItems = [
  { to: "/student", label: "工作台", icon: Home, end: true },
  { to: "/my-exams", label: "我的考试", icon: ClipboardList },
  { to: "/wrong-answers", label: "错题回顾", icon: NotebookPen },
];

export function StudentLayout() {
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{ name: string; primary_org?: { role_name: string } | null }>();
  const [notifications, setNotifications] = useState<IStudentNotification[]>([]);
  const [activeNotification, setActiveNotification] = useState<IStudentNotification | null>(null);
  const name = identity?.name ?? "考生";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    api
      .get<IStudentNotification[]>("/api/student/notifications/unread")
      .then((response) => {
        if (cancelled) return;
        setNotifications(response.data);
        setActiveNotification(response.data[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setNotifications([]);
          setActiveNotification(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCloseNotification = async () => {
    if (!activeNotification) return;
    const currentId = activeNotification.id;
    const nextNotifications = notifications.filter((item) => item.id !== currentId);
    setNotifications(nextNotifications);
    setActiveNotification(nextNotifications[0] ?? null);
    try {
      await api.post(`/api/student/notifications/${currentId}/read`);
    } catch {
      // Keep dismissal local even if marking read fails.
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/30 text-foreground">
      <header className="z-30 shrink-0 border-b border-border/50 bg-background/85 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-6 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link to="/student" className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <GraduationCap size={18} />
              </div>
              <span className="text-sm font-bold tracking-tight">智评云考试</span>
            </Link>

            <nav className="hidden items-center gap-1.5 md:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "group relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition-all duration-200 ease-out",
                      isActive
                        ? "border border-border/70 bg-background text-foreground shadow-sm"
                        : "border border-transparent text-muted-foreground hover:border-border/50 hover:bg-muted/50 hover:text-foreground",
                    )
                  }
                >
                  <item.icon
                    size={15}
                    className="opacity-70 transition-all duration-200 group-hover:scale-105 group-hover:opacity-100"
                  />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <ThemeCustomizer />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-full border border-border/40 py-1 pl-3 pr-1 transition-all hover:bg-muted/50 active:scale-95">
                  <span className="text-[11px] font-black text-foreground/70 uppercase tracking-wider">{name}</span>
                  <Avatar className="h-8 w-8 shadow-sm ring-1 ring-border/20">
                    <AvatarFallback className="bg-primary/5 text-[10px] font-black text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-2xl border-border/40 p-1.5 shadow-2xl">
                <div className="mb-1 border-b border-border/40 px-2 py-2">
                  <p className="text-xs font-black text-foreground">{name}</p>
                  <p className="truncate text-[10px] font-medium text-muted-foreground">学号：20240407001</p>
                </div>
                <DropdownMenuItem onClick={() => logout()} className="rounded-xl font-semibold text-destructive focus:bg-destructive/10 focus:text-destructive">
                  <LogOut size={14} className="mr-2" />
                  退出系统
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-muted/30 px-4 py-6 md:px-6 md:py-8">
        <div className="mx-auto max-w-[1200px]">
          <Outlet />
        </div>
      </main>

      <Dialog open={!!activeNotification} onOpenChange={(open) => {
        if (!open) void handleCloseNotification();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{activeNotification?.title ?? "站内提醒"}</DialogTitle>
            <DialogDescription className="leading-6">
              {activeNotification?.content}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {activeNotification?.related_exam_id ? (
              <Button asChild variant="outline">
                <Link to={`/my-exams/${activeNotification.related_exam_id}/result`} onClick={() => void handleCloseNotification()}>
                  查看结果
                </Link>
              </Button>
            ) : null}
            <Button onClick={() => void handleCloseNotification()}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
