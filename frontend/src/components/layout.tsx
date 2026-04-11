import { useLogout, useGetIdentity } from "@refinedev/core";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getUserRole } from "@/types/rbac";
import {
  BookOpen,
  ClipboardList,
  FileCheck,
  BarChart3,
  GraduationCap,
  Tags,
  FilePlus,
  Upload,
  ListChecks,
  Send,
  LayoutDashboard,
  Network,
} from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { Separator } from "@/components/ui/separator";
import { UserDropdown } from "./user-dropdown";
import { ThemeCustomizer } from "./theme-customizer";
import { useTheme } from "./theme-provider";
import { cn } from "@/lib/utils";
import React from "react";
import { canAccessJobModels } from "@/utils/role-routing";

/* ------------------------------------------------------------------ */
/*  NavItem – 下拉面板中的导航项（用 div+onClick 避免 Radix nested <a>）     */
/* ------------------------------------------------------------------ */

function NavItem({
  href,
  title,
  icon,
  children,
  className,
}: {
  href: string;
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={() => navigate(href)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(href);
          }
        }}
        className={cn(
          "block select-none rounded-md p-3 leading-none outline-none transition-colors cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-sm font-medium leading-none">
          {icon}
          {title}
        </div>
        {children && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {children}
          </p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Layout                                                        */
/* ------------------------------------------------------------------ */

export function Layout() {
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{ name: string; primary_org?: { role_name: string } | null }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved: themeMode } = useTheme();

  const isActive = (prefix: string) => location.pathname.startsWith(prefix);
  const role = identity ? getUserRole(identity) : "";
  const isTeacher = role === "teacher";
  const isEnterprise = canAccessJobModels(role) && role !== "platform_admin";
  const isAdmin = role === "platform_admin";
  const isKnowledgePage = location.pathname.startsWith("/knowledge");
  const isGradingPage = location.pathname.startsWith("/grading");
  const isQuestionImportPage = location.pathname === "/questions/import";
  const isFullScreenPage = isKnowledgePage || isGradingPage || isQuestionImportPage;

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={(() => {
        if (themeMode === "dark") {
          return {
            backgroundColor: "#0f0f12",
            backgroundImage: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.08), transparent)",
          };
        }
        return {
          backgroundColor: "#f8f9fb",
          backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.05), transparent)",
        };
      })()}
    >
      <header className="bg-background border-b border-border shrink-0">
        <div className="flex items-center h-14 px-4 sm:px-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <GraduationCap size={18} className="text-white" />
            </div>
            <span className="text-base font-bold text-foreground tracking-tight hidden sm:inline">
              智评云
            </span>
          </Link>

          {/* NavigationMenu 居中 */}
          <div className="flex-1 flex items-center justify-center px-4">
            <NavigationMenu viewport={false}>
              <NavigationMenuList>
                {/* ---- 工作台 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        location.pathname === "/" || location.pathname === "/dashboard"
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/");
                      }}
                    >
                      <LayoutDashboard size={16} className="mr-1.5" />
                      工作台
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 阅卷中心 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/grading") ? "bg-accent/50 text-accent-foreground" : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/grading");
                      }}
                    >
                      <FileCheck size={16} className="mr-1.5" />
                      阅卷中心
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 考试管理 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem className="relative">
                    <NavigationMenuTrigger
                      className={cn(isActive("/exams") ? "bg-accent/50 text-accent-foreground" : "")}
                    >
                      <ClipboardList size={16} className="mr-1.5" />
                      考试管理
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="absolute left-0 top-full z-50 mt-1.5 w-auto overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
                      <ul className="grid w-[400px] gap-1 p-2 md:w-[440px] md:grid-cols-2">
                        <NavItem href="/exams" title="考试列表" icon={<ListChecks size={14} />}>
                          查看所有考试及状态
                        </NavItem>
                        <NavItem href="/exams/create" title="创建考试" icon={<FilePlus size={14} />}>
                          新建考试、组卷、设置时间
                        </NavItem>
                        <NavItem href="/exams/submissions" title="提交记录" icon={<Send size={14} />}>
                          查看考生答卷与提交状态
                        </NavItem>
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                )}

                {/* ---- 岗位模型 (企业、学校管理员、管理员) ---- */}
                {(isEnterprise || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/gwmx") ? "bg-accent/50 text-accent-foreground" : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/gwmx/job-models");
                      }}
                    >
                      <GraduationCap size={16} className="mr-1.5" />
                      岗位模型
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 题库管理 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem className="relative">
                    <NavigationMenuTrigger
                      className={cn(
                        isActive("/questions") ||
                          isActive("/tags") ||
                          isActive("/knowledge")
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
                      )}
                    >
                      <BookOpen size={16} className="mr-1.5" />
                      题库管理
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="absolute left-0 top-full z-50 mt-1.5 w-auto overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
                      <ul className="grid w-[400px] gap-1 p-2 md:w-[440px] md:grid-cols-2">
                        <NavItem href="/questions" title="题目列表" icon={<ListChecks size={14} />}>
                          浏览和管理所有题目
                        </NavItem>
                        <NavItem href="/questions/create" title="创建题目" icon={<FilePlus size={14} />}>
                          新建选择题、填空题、主观题等
                        </NavItem>
                        <NavItem href="/questions/import" title="导入题目" icon={<Upload size={14} />}>
                          导入 PDF、Word、Markdown 题目
                        </NavItem>
                        <NavItem href="/tags" title="标签管理" icon={<Tags size={14} />}>
                          为题目打标签，方便筛选检索
                        </NavItem>
                        <NavItem href="/knowledge" title="知识点管理" icon={<Network size={14} />}>
                          可视化知识树，前置依赖管理
                        </NavItem>
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                )}

                {/* ---- 数据分析 (管理员) ---- */}
                {isAdmin && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(navigationMenuTriggerStyle())}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/analytics");
                      }}
                    >
                      <BarChart3 size={16} className="mr-1.5" />
                      数据分析
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* 右侧：主题 + 用户 */}
          <div className="flex items-center gap-1 shrink-0">
            <ThemeCustomizer />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <UserDropdown name={identity?.name ?? "用户"} role={identity ? getUserRole(identity) : undefined} onLogout={() => logout()} />
          </div>
        </div>
      </header>

      <main className={cn("flex-1", isFullScreenPage ? "min-h-0 overflow-hidden" : "overflow-y-auto")}>
        <div
          className={cn(
            isFullScreenPage
              ? "h-full min-h-0 w-full px-0 py-0"
              : "mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6",
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
