import { Drawer } from "vaul";
import { X, LogOut, Moon, Sun, Globe } from "lucide-react";
import { useLogout, useGetIdentity } from "@refinedev/core";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";

interface MeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getLocaleLabel(locale: string) {
  return locale === "en" ? "English" : "中文";
}

function toggleLocale() {
  const current = localStorage.getItem("student_locale") ?? "zh";
  const next = current === "zh" ? "en" : "zh";
  localStorage.setItem("student_locale", next);
  window.location.reload();
}

export function MeSheet({ open, onOpenChange }: MeSheetProps) {
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{
    name: string;
    username?: string;
    primary_org?: { role_name: string } | null;
  }>();
  const { theme, setTheme } = useTheme();

  const name = identity?.name ?? "考生";
  const username = identity?.username ?? "";
  const roleLabel = identity?.primary_org?.role_name ?? "";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const locale = localStorage.getItem("student_locale") ?? "zh";

  const isDark = theme === "dark";

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-background max-h-[70dvh]">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b shrink-0">
            <Drawer.Title className="text-base font-semibold">我的</Drawer.Title>
            <button onClick={() => onOpenChange(false)} className="text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {/* Profile row */}
            <div className="flex items-center gap-3 px-4 py-4 border-b">
              <Avatar className="h-12 w-12 ring-2 ring-border">
                <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{name}</p>
                {username && <p className="text-xs text-muted-foreground truncate">@{username}</p>}
              </div>
              {roleLabel && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {roleLabel}
                </Badge>
              )}
            </div>

            {/* Settings rows */}
            <ul className="divide-y">
              {/* Theme toggle */}
              <li>
                <button
                  className="w-full flex items-center justify-between px-4 py-4 text-sm"
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                  <div className="flex items-center gap-3">
                    {isDark ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                    <span>外观</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{isDark ? "深色" : "浅色"}</span>
                </button>
              </li>

              {/* Language toggle */}
              <li>
                <button
                  className="w-full flex items-center justify-between px-4 py-4 text-sm"
                  onClick={toggleLocale}
                >
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <span>语言</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{getLocaleLabel(locale)}</span>
                </button>
              </li>

              {/* Install entry (stub, Phase 3 wires it) */}
              <li>
                <div className="w-full flex items-center justify-between px-4 py-4 text-sm opacity-50">
                  <div className="flex items-center gap-3">
                    <span className="h-4 w-4 flex items-center justify-center text-muted-foreground text-xs">⊕</span>
                    <span>安装应用</span>
                  </div>
                  <span className="text-xs text-muted-foreground">即将推出</span>
                </div>
              </li>

              {/* Logout */}
              <li>
                <button
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm text-destructive"
                  onClick={() => {
                    onOpenChange(false);
                    logout();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  <span>退出登录</span>
                </button>
              </li>
            </ul>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
