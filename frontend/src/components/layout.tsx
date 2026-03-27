import { useLogout, useGetIdentity } from "@refinedev/core";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  CalendarClock,
  Send,
  ScanEye,
  Bot,
  MessageSquareText,
  Scale,
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
  const { data: identity } = useGetIdentity<{ name: string; role?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved: themeMode } = useTheme();

  const isActive = (prefix: string) => location.pathname.startsWith(prefix);
  const isStudent = identity?.role === "student";
  const isKnowledgePage = location.pathname.startsWith("/knowledge");

  return (
    <div
      className="flex flex-col h-screen"
      style={(() => {
        const bg = themeMode === "dark" ? "#131316" : "#FEFEFA";
        const line = themeMode === "dark" ? "#1a1a1f" : "#FAFAFA";
        return {
          backgroundColor: bg,
          backgroundImage: `linear-gradient(0deg, transparent 24%, ${line} 25%, ${line} 26%, transparent 27%, transparent 74%, ${line} 75%, ${line} 76%, transparent 77%, transparent),
            linear-gradient(90deg, transparent 24%, ${line} 25%, ${line} 26%, transparent 27%, transparent 74%, ${line} 75%, ${line} 76%, transparent 77%, transparent)`,
          backgroundSize: "55px 55px",
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
            <NavigationMenu>
              <NavigationMenuList>
                {!isStudent && (
                  <>
                    {/* ---- 工作台 ---- */}
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

                    {/* ---- 题库管理 ---- */}
                    <NavigationMenuItem>
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
                      <NavigationMenuContent>
                        <ul className="grid w-[400px] gap-1 p-2 md:w-[440px] md:grid-cols-2">
                          <NavItem href="/questions" title="题目列表" icon={<ListChecks size={14} />}>
                            浏览和管理所有题目
                          </NavItem>
                          <NavItem href="/questions/create" title="创建题目" icon={<FilePlus size={14} />}>
                            新建选择题、填空题、主观题等
                          </NavItem>
                          <NavItem href="/questions/import" title="导入题目" icon={<Upload size={14} />}>
                            导入 Excel、Word、PDF、TXT 题目
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

                    {/* ---- 考试管理 ---- */}
                    <NavigationMenuItem>
                      <NavigationMenuTrigger
                        className={cn(isActive("/exams") ? "bg-accent/50 text-accent-foreground" : "")}
                      >
                        <ClipboardList size={16} className="mr-1.5" />
                        考试管理
                      </NavigationMenuTrigger>
                      <NavigationMenuContent>
                        <ul className="grid w-[400px] gap-1 p-2 md:w-[440px] md:grid-cols-2">
                          <NavItem href="/exams" title="考试列表" icon={<ListChecks size={14} />}>
                            查看所有考试及状态
                          </NavItem>
                          <NavItem href="/exams/create" title="创建考试" icon={<FilePlus size={14} />}>
                            新建考试、组卷、设置时间
                          </NavItem>
                          <NavItem href="/exams/schedule" title="考试安排" icon={<CalendarClock size={14} />}>
                            排期管理与考生分配
                          </NavItem>
                          <NavItem href="/exams/submissions" title="提交记录" icon={<Send size={14} />}>
                            查看考生答卷与提交状态
                          </NavItem>
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>

                    {/* ---- 阅卷中心 ---- */}
                    <NavigationMenuItem>
                      <NavigationMenuTrigger
                        className={cn(isActive("/grading") ? "bg-accent/50 text-accent-foreground" : "")}
                      >
                        <FileCheck size={16} className="mr-1.5" />
                        阅卷中心
                      </NavigationMenuTrigger>
                      <NavigationMenuContent>
                        <ul className="grid w-[400px] gap-1 p-2 md:w-[440px] md:grid-cols-2">
                          <NavItem href="/grading" title="待阅卷" icon={<ScanEye size={14} />}>
                            人工阅卷与评分
                          </NavItem>
                          <NavItem href="/grading/ai" title="AI 评分" icon={<Bot size={14} />}>
                            多模型协同智能评分
                          </NavItem>
                          <NavItem href="/grading/appeals" title="成绩申诉" icon={<MessageSquareText size={14} />}>
                            处理学生评分异议
                          </NavItem>
                          <NavItem href="/grading/arbitration" title="仲裁记录" icon={<Scale size={14} />}>
                            查看 AI 评分仲裁详情
                          </NavItem>
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>

                    {/* ---- 数据分析（无下拉） ---- */}
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


                  </>
                )}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* 右侧：主题 + 用户 */}
          <div className="flex items-center gap-1 shrink-0">
            <ThemeCustomizer />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <UserDropdown name={identity?.name ?? "用户"} role={identity?.role} onLogout={() => logout()} />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div
          className={cn(
            isKnowledgePage
              ? "w-full px-0 py-0"
              : "mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6",
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
