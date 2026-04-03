import { useLogout, useGetIdentity } from "@refinedev/core";
import { Link, NavLink, Outlet } from "react-router-dom";
import { GraduationCap, Home, ClipboardList, NotebookPen, Search, Bell, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";
import { ThemeCustomizer } from "./theme-customizer";

const navItems = [
  { to: "/student", label: "首页", icon: Home, end: true },
  { to: "/my-exams", label: "我的考试", icon: ClipboardList },
  { to: "/wrong-answers", label: "错题本", icon: NotebookPen },
];

export function StudentLayout() {
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{ name: string; primary_org?: { role_name: string } | null }>();
  const name = identity?.name ?? "考生";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen bg-background">
      {/* ── Sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card border-r border-border py-8">
        {/* Logo */}
        <Link to="/student" className="flex items-center gap-3 px-8 mb-12">
          <div className="w-10 h-10 bg-primary rounded-[var(--radius)] flex items-center justify-center text-primary-foreground shadow-md">
            <GraduationCap size={22} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">考试通</h1>
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">
              Smart Exam
            </p>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all rounded-r-[var(--radius)] ${
                  isActive
                    ? "text-primary border-l-[3px] border-primary bg-gradient-to-r from-primary/10 to-transparent"
                    : "text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-[var(--radius)]"
                }`
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Top bar ── */}
      <header className="fixed top-0 right-0 z-40 w-[calc(100%-16rem)] h-16 flex items-center justify-between px-10 border-b border-border/50 bg-card/70 backdrop-blur-xl">
        {/* Search */}
        <div className="flex items-center gap-4 flex-1 max-w-xl">
          <div className="relative w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索考试..."
              className="pl-10 h-9 bg-muted/50 border-none text-sm focus-visible:ring-primary/20"
            />
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <button className="relative p-2 text-muted-foreground hover:bg-primary/5 rounded-[var(--radius)] transition-colors">
              <Bell size={18} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full ring-2 ring-card" />
            </button>
            <ThemeCustomizer />
          </div>
          <div className="h-6 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                    当前考生
                  </p>
                  <p className="text-sm font-bold text-foreground">{name}</p>
                </div>
                <Avatar className="h-10 w-10 ring-2 ring-primary/20">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive">
                <LogOut size={14} />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="ml-64 pt-24 pb-12 px-10 min-h-screen flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
