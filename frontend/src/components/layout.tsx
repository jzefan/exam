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
  FileText,
  Wrench,
  LibraryBig,
  Menu,
  X,
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
import { OnboardingGuide } from "./onboarding-guide";

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
/*  Mobile nav helpers                                                 */
/* ------------------------------------------------------------------ */

function MobileNavItem({
  icon,
  label,
  active,
  onClick,
  subItem,
}: {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  subItem?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
        subItem && "pl-9",
        active
          ? "bg-accent/50 text-accent-foreground"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileNavSection({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
      {icon}
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Layout                                                        */
/* ------------------------------------------------------------------ */

export function Layout() {
  const { mutate: logout } = useLogout();
  const { data: identity } = useGetIdentity<{
    name: string;
    persona?: string | null;
    primary_org?: { role_name: string } | null;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolved: themeMode } = useTheme();
  const brand = useBrand();

  const isActive = (prefix: string) => location.pathname.startsWith(prefix);
  const role = identity ? getUserRole(identity) : "";
  const isTeacher = role === "teacher" || role === "evaluator";
  // 我的课程是教师视角入口；evaluator 仍走题库 → 知识点管理。
  const canUseCourses = role === "teacher";
  const isEnterprise = canAccessJobModels(role) && role !== "platform_admin";
  const isAdmin = role === "platform_admin";
  const isKnowledgePage = location.pathname.startsWith("/knowledge");
  const isGradingPage = location.pathname.startsWith("/grading");
  const isQuestionImportPage = location.pathname === "/questions/import";
  const isPaperImportPage = location.pathname === "/papers/import";
  const isCoursesPage = location.pathname.startsWith("/courses");
  // 课程详情：整屏左右两栏布局（侧栏 + 内容），自己管理滚动。
  const isCourseDetailPage = /^\/courses\/[^/]+$/.test(location.pathname);
  // 课程组卷创建：整屏题目工作台，自己管理顶部与列表滚动。
  const isCoursePaperCreatePage = /^\/courses\/[^/]+\/papers\/create$/.test(location.pathname);
  // 岗位-课程图谱：整屏画布（React Flow），需要占满浏览器宽高、自管理布局。
  const isJobGraphPage = location.pathname === "/gwmx/job-models/graph";
  const isExamWorkflowPage =
    location.pathname === "/exams/practice/create" ||
    location.pathname.startsWith("/exams/practice/edit/") ||
    /^\/exams\/[^/]+\/view$/.test(location.pathname) ||
    /^\/courses\/[^/]+\/question-skills$/.test(location.pathname);
  const isFullScreenPage =
    isKnowledgePage ||
    isGradingPage ||
    isQuestionImportPage ||
    isPaperImportPage ||
    isCourseDetailPage ||
    isCoursePaperCreatePage ||
    isJobGraphPage;
  const isAnalysisPage = /^\/exams\/[^/]+\/analysis/.test(location.pathname);
  // 从「我的课程」进入的考试 / 练习相关页（创建、编辑、查看、分析）：顶部导航仍高亮
  // 「我的课程」而非「考试管理」。来源通过导航 state 的 backTo(/courses…) 或 courseOrigin 判断。
  const examNavState = (location.state ?? {}) as {
    backTo?: string;
    courseOrigin?: boolean;
  };
  const fromCoursesExamFlow =
    (location.pathname.startsWith("/exams") ||
      location.pathname.startsWith("/papers")) &&
    (examNavState.courseOrigin === true ||
      String(examNavState.backTo ?? "").startsWith("/courses/"));
  const coursesNavActive = isCoursesPage || fromCoursesExamFlow;
  const examsNavActive =
    (isActive("/exams") || isActive("/papers")) && !fromCoursesExamFlow;
  const [examMenuOpen, setExamMenuOpen] = useState(false);
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const go = (path: string) => {
    closeMobileMenu();
    navigate(path);
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={(() => {
        if (themeMode === "dark") {
          return {
            backgroundColor: "#0f0f12",
            backgroundImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.08), transparent)",
          };
        }
        return {
          backgroundColor: "#f8f9fb",
          backgroundImage:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.05), transparent)",
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

          {/* 移动端汉堡菜单按钮 */}
          <button
            type="button"
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="打开菜单"
          >
            <Menu size={20} />
          </button>

          {/* NavigationMenu 居中（桌面端） */}
          <div className="hidden md:flex flex-1 items-center justify-center px-4">
            <NavigationMenu viewport={false}>
              <NavigationMenuList>
                {/* ---- 工作台 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        location.pathname === "/" ||
                          location.pathname === "/dashboard"
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

                {/* ---- 我的课程 (教师、管理员)；evaluator 不显示 ---- */}
                {(canUseCourses || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      data-onboarding="nav-courses"
                      className={cn(
                        navigationMenuTriggerStyle(),
                        coursesNavActive
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/courses");
                      }}
                    >
                      <LibraryBig size={16} className="mr-1.5" />
                      我的课程
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 阅卷中心 (教师、管理员) ---- */}
                {(isTeacher || isAdmin) && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/grading")
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
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

                {/* ---- 考试管理 (评估员、管理员；教师改用「我的课程」内的考试/练习) ---- */}
                {(role === "evaluator" || isAdmin) && (
                  <NavigationMenuItem className="relative">
                    <DropdownMenu
                      open={examMenuOpen}
                      onOpenChange={setExamMenuOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            navigationMenuTriggerStyle(),
                            examsNavActive
                              ? "bg-accent/50 text-accent-foreground"
                              : "",
                          )}
                        >
                          <ClipboardList size={16} className="mr-1.5" />
                          考试管理
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="mt-1.5 w-[440px] rounded-md border border-border p-2 shadow-lg"
                      >
                        <ul className="grid gap-1 md:grid-cols-2">
                          <NavItem
                            href="/exams"
                            title="考试与练习"
                            icon={<ListChecks size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            查看所有考试、练习及状态
                          </NavItem>
                          <NavItem
                            href="/exams/create"
                            title="创建考试"
                            icon={<FilePlus size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            新建考试、组卷、设置时间
                          </NavItem>
                          <NavItem
                            href="/exams/practice/create"
                            title="发布练习"
                            icon={<FilePlus size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            按知识点、题目和学生快速发布练习
                          </NavItem>
                          <NavItem
                            href="/exams/students"
                            title="考试考生"
                            icon={<Send size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            查看各场考试下的考生列表
                          </NavItem>
                          <NavItem
                            href="/papers"
                            title="试卷列表"
                            icon={<FileText size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            管理手工与导入试卷资产
                          </NavItem>
                          <NavItem
                            href="/papers/import"
                            title="导入试卷"
                            icon={<Upload size={14} />}
                            onNavigate={() => setExamMenuOpen(false)}
                          >
                            识别历史试卷并入库复用
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
                        isActive("/gwmx/workbench")
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
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
                        isActive("/gwmx/job-models")
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
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

                {/* ---- 运营管理 (平台管理员) ---- */}
                {isAdmin && (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/operations")
                          ? "bg-accent/50 text-accent-foreground"
                          : "",
                      )}
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        navigate("/operations");
                      }}
                    >
                      <Wrench size={16} className="mr-1.5" />
                      运营管理
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )}

                {/* ---- 题库管理 (评估员、管理员；教师改用「我的课程」内的题库能力) ---- */}
                {(role === "evaluator" || isAdmin) && (
                  <NavigationMenuItem className="relative">
                    <DropdownMenu
                      open={questionMenuOpen}
                      onOpenChange={setQuestionMenuOpen}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          data-onboarding="nav-questions"
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
                      <DropdownMenuContent
                        align="start"
                        className="mt-1.5 w-[440px] rounded-md border border-border p-2 shadow-lg"
                      >
                        <ul className="grid gap-1 md:grid-cols-2">
                          <NavItem
                            href="/questions"
                            title="题目列表"
                            icon={<ListChecks size={14} />}
                            onNavigate={() => setQuestionMenuOpen(false)}
                          >
                            浏览和管理所有题目
                          </NavItem>
                          <NavItem
                            href="/questions/create"
                            title="创建题目"
                            icon={<FilePlus size={14} />}
                            onNavigate={() => setQuestionMenuOpen(false)}
                          >
                            新建选择题、填空题、主观题等
                          </NavItem>
                          <NavItem
                            href="/questions/import"
                            title="导入题目"
                            icon={<Upload size={14} />}
                            onNavigate={() => setQuestionMenuOpen(false)}
                          >
                            导入 PDF、Word、Markdown 题目
                          </NavItem>
                          <NavItem
                            href="/tags"
                            title="标签管理"
                            icon={<Tags size={14} />}
                            onNavigate={() => setQuestionMenuOpen(false)}
                          >
                            为题目打标签，方便筛选检索
                          </NavItem>
                          <NavItem
                            href="/knowledge"
                            title="知识点管理"
                            icon={<Network size={14} />}
                            onNavigate={() => setQuestionMenuOpen(false)}
                          >
                            管理专业 / 方向 / 主知识点的层级与前置依赖
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
            <Separator
              orientation="vertical"
              className="mx-1 h-5 hidden sm:block"
            />
            <UserDropdown
              name={identity?.name ?? "用户"}
              role={identity ? getUserRole(identity) : undefined}
              persona={identity?.persona}
              onLogout={() => logout()}
            />
          </div>
        </div>
      </header>

      {/* 移动端导航抽屉 */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={closeMobileMenu}
          />
          <div className="absolute right-0 top-0 h-full w-[85vw] max-w-sm bg-background shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-border px-4 h-14 shrink-0">
              <span className="text-base font-bold text-foreground">
                导航菜单
              </span>
              <button
                type="button"
                onClick={closeMobileMenu}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors"
                aria-label="关闭菜单"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <nav className="space-y-0.5">
                {/* 工作台 (教师、管理员) */}
                {(isTeacher || isAdmin) && (
                  <MobileNavItem
                    icon={<LayoutDashboard size={18} />}
                    label="工作台"
                    active={
                      location.pathname === "/" ||
                      location.pathname === "/dashboard"
                    }
                    onClick={() => go("/")}
                  />
                )}
                {/* 我的课程 */}
                {(canUseCourses || isAdmin) && (
                  <MobileNavItem
                    icon={<LibraryBig size={18} />}
                    label="我的课程"
                    active={coursesNavActive}
                    onClick={() => go("/courses")}
                  />
                )}
                {/* 阅卷中心 */}
                {(isTeacher || isAdmin) && (
                  <MobileNavItem
                    icon={<FileCheck size={18} />}
                    label="阅卷中心"
                    active={isActive("/grading")}
                    onClick={() => go("/grading")}
                  />
                )}
                {/* 考试管理 (展开子项) */}
                {(role === "evaluator" || isAdmin) && (
                  <>
                    <MobileNavSection
                      label="考试管理"
                      icon={<ClipboardList size={16} />}
                    />
                    <MobileNavItem
                      label="考试与练习"
                      subItem
                      active={examsNavActive}
                      onClick={() => go("/exams")}
                    />
                    <MobileNavItem
                      label="创建考试"
                      subItem
                      onClick={() => go("/exams/create")}
                    />
                    <MobileNavItem
                      label="发布练习"
                      subItem
                      onClick={() => go("/exams/practice/create")}
                    />
                    <MobileNavItem
                      label="考试考生"
                      subItem
                      onClick={() => go("/exams/students")}
                    />
                    <MobileNavItem
                      label="试卷列表"
                      subItem
                      active={isActive("/papers")}
                      onClick={() => go("/papers")}
                    />
                    <MobileNavItem
                      label="导入试卷"
                      subItem
                      onClick={() => go("/papers/import")}
                    />
                  </>
                )}
                {/* 工作台 (企业、学校管理员) */}
                {isEnterprise && (
                  <MobileNavItem
                    icon={<LayoutDashboard size={18} />}
                    label="工作台"
                    active={isActive("/gwmx/workbench")}
                    onClick={() => go("/gwmx/workbench")}
                  />
                )}
                {/* 岗位模型 */}
                {(isEnterprise || isAdmin) && (
                  <MobileNavItem
                    icon={<GraduationCap size={18} />}
                    label="岗位模型"
                    active={isActive("/gwmx/job-models")}
                    onClick={() => go("/gwmx/job-models")}
                  />
                )}
                {/* 运营管理 */}
                {isAdmin && (
                  <MobileNavItem
                    icon={<Wrench size={18} />}
                    label="运营管理"
                    active={isActive("/operations")}
                    onClick={() => go("/operations")}
                  />
                )}
                {/* 题库管理 (展开子项) */}
                {(role === "evaluator" || isAdmin) && (
                  <>
                    <MobileNavSection
                      label="题库管理"
                      icon={<BookOpen size={16} />}
                    />
                    <MobileNavItem
                      label="题目列表"
                      subItem
                      active={isActive("/questions")}
                      onClick={() => go("/questions")}
                    />
                    <MobileNavItem
                      label="创建题目"
                      subItem
                      onClick={() => go("/questions/create")}
                    />
                    <MobileNavItem
                      label="导入题目"
                      subItem
                      active={isActive("/questions/import")}
                      onClick={() => go("/questions/import")}
                    />
                    <MobileNavItem
                      label="标签管理"
                      subItem
                      active={isActive("/tags")}
                      onClick={() => go("/tags")}
                    />
                    <MobileNavItem
                      label="知识点管理"
                      subItem
                      active={isActive("/knowledge")}
                      onClick={() => go("/knowledge")}
                    />
                  </>
                )}
                {/* 数据分析 */}
                {isAdmin && (
                  <MobileNavItem
                    icon={<BarChart3 size={18} />}
                    label="数据分析"
                    onClick={() => go("/analytics")}
                  />
                )}
              </nav>
            </div>
          </div>
        </div>
      )}

      <OnboardingGuide
        enabled={role === "teacher" && identity?.persona !== "assessor"}
      />

      <main
        className={cn(
          "flex-1",
          isFullScreenPage
            ? "min-h-0 overflow-hidden"
            : "overflow-y-auto overflow-x-hidden",
        )}
      >
        <div
          className={cn(
            isFullScreenPage
              ? "h-full min-h-0 w-full px-0 py-0"
              : isAnalysisPage
                ? "w-full px-0 py-0"
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
