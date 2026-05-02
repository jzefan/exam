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
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { BrandLogoMark } from "@/components/brand-logo";
import { useBrand } from "@/lib/brand";
import { UserDropdown } from "./user-dropdown";
import { ThemeCustomizer } from "./theme-customizer";
import { NotificationCenter } from "./notifications/notification-center";
import { useTheme } from "./theme-provider";
import { cn } from "@/lib/utils";
import React, { useState } from "react";
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
  onNavigate,
}: {
  href: string;
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();

  const handleNavigate = () => {
    onNavigate?.();
    navigate(href);
  };

  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleNavigate();
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
  const { data: identity } = useGetIdentity<{ name: string; persona?: string | null; primary_org?: { role_name: string } | null }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved: themeMode } = useTheme();
  const brand = useBrand();

  const isActive = (prefix: string) => location.pathname.startsWith(prefix);
  const role = identity ? getUserRole(identity) : "";
  const isTeacher = role === "teacher" || role === "evaluator";
  const isEnterprise = canAccessJobModels(role) && role !== "platform_admin";
  const isAdmin = role === "platform_admin";
  const isKnowledgePage = location.pathname.startsWith("/knowledge");
  const isGradingPage = location.pathname.startsWith("/grading");
  const isQuestionImportPage = location.pathname === "/questions/import";
  const isExamWorkflowPage =
    location.pathname === "/exams/practice/create" ||
    location.pathname.startsWith("/exams/practice/edit/") ||
    /^\/exams\/[^/]+\/view$/.test(location.pathname);
  const isFullScreenPage = isKnowledgePage || isGradingPage || isQuestionImportPage;
  const [examMenuOpen, setExamMenuOpen] = useState(false);
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);

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
            <BrandLogoMark className="h-8 w-8 rounded-lg" />
            <span className="text-base font-bold text-foreground tracking-tight hidden sm:inline">
              {brand.name}
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
                    <DropdownMenu open={examMenuOpen} onOpenChange={setExamMenuOpen}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            navigationMenuTriggerStyle(),
                            isActive("/exams") ? "bg-accent/50 text-accent-foreground" : "",
                          )}
                        >
                          <ClipboardList size={16} className="mr-1.5" />
                          考试管理
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="mt-1.5 w-[440px] rounded-md border border-border p-2 shadow-lg">
                        <ul className="grid gap-1 md:grid-cols-2">
                          <NavItem href="/exams" title="考试与练习" icon={<ListChecks size={14} />} onNavigate={() => setExamMenuOpen(false)}>
                            查看所有考试、练习及状态
                          </NavItem>
                          <NavItem href="/exams/create" title="创建考试" icon={<FilePlus size={14} />} onNavigate={() => setExamMenuOpen(false)}>
                            新建考试、组卷、设置时间
                          </NavItem>
                          <NavItem href="/exams/practice/create" title="发布练习" icon={<FilePlus size={14} />} onNavigate={() => setExamMenuOpen(false)}>
                            按知识点、题目和学生快速发布练习
                          </NavItem>
                          <NavItem href="/exams/students" title="考试考生" icon={<Send size={14} />} onNavigate={() => setExamMenuOpen(false)}>
                            查看各场考试下的考生列表
                          </NavItem>
                        </ul>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </NavigationMenuItem>
                )}

                {/* ---- 工作台 (企业、学校管理员) ---- */}
                {isEnterprise && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/gwmx/workbench") ? "bg-accent/50 text-accent-foreground" : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/gwmx/workbench");
                      }}
                    >
                      <LayoutDashboard size={16} className="mr-1.5" />
                      工作台
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 岗位模型 (企业、学校管理员、管理员) ---- */}
                {(isEnterprise || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/gwmx/job-models") ? "bg-accent/50 text-accent-foreground" : "",
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
                    <DropdownMenu open={questionMenuOpen} onOpenChange={setQuestionMenuOpen}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            navigationMenuTriggerStyle(),
                            isActive("/questions") ||
                              isActive("/tags") ||
                              isActive("/knowledge")
                              ? "bg-accent/50 text-accent-foreground"
                              : "",
                          )}
                        >
                          <BookOpen size={16} className="mr-1.5" />
                          题库管理
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="mt-1.5 w-[440px] rounded-md border border-border p-2 shadow-lg">
                        <ul className="grid gap-1 md:grid-cols-2">
                          <NavItem href="/questions" title="题目列表" icon={<ListChecks size={14} />} onNavigate={() => setQuestionMenuOpen(false)}>
                            浏览和管理所有题目
                          </NavItem>
                          <NavItem href="/questions/create" title="创建题目" icon={<FilePlus size={14} />} onNavigate={() => setQuestionMenuOpen(false)}>
                            新建选择题、填空题、主观题等
                          </NavItem>
                          <NavItem href="/questions/import" title="导入题目" icon={<Upload size={14} />} onNavigate={() => setQuestionMenuOpen(false)}>
                            导入 PDF、Word、Markdown 题目
                          </NavItem>
                          <NavItem href="/tags" title="标签管理" icon={<Tags size={14} />} onNavigate={() => setQuestionMenuOpen(false)}>
                            为题目打标签，方便筛选检索
                          </NavItem>
                          <NavItem href="/knowledge" title="知识点管理" icon={<Network size={14} />} onNavigate={() => setQuestionMenuOpen(false)}>
                            可视化知识树，前置依赖管理
                          </NavItem>
                        </ul>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

          {/* 右侧：主题 + 通知 + 用户 */}
          <div className="flex items-center gap-1 shrink-0">
            <ThemeCustomizer />
            {(isTeacher || isAdmin) && <NotificationCenter />}
            <Separator orientation="vertical" className="mx-1 h-5" />
            <UserDropdown
              name={identity?.name ?? "用户"}
              role={identity ? getUserRole(identity) : undefined}
              persona={identity?.persona}
              onLogout={() => logout()}
            />
          </div>
        </div>
      </header>

      <main className={cn("flex-1", isFullScreenPage ? "min-h-0 overflow-hidden" : "overflow-y-auto")}>
        <div
          className={cn(
            isFullScreenPage
              ? "h-full min-h-0 w-full px-0 py-0"
              : isExamWorkflowPage
                ? "w-full px-4 py-6 sm:px-6"
              : "mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6",
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
