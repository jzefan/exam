import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Refine, Authenticated, useGetIdentity } from "@refinedev/core";
import routerProvider, { CatchAllNavigate } from "@refinedev/react-router";
import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";

import { dataProvider } from "./providers/data-provider";
import { authProvider } from "./providers/auth-provider";
import { accessControlProvider } from "./providers/access-control";
import { getUserRole } from "@/types/rbac";
import { ThemeProvider } from "./components/theme-provider";
import { ThemeConfigProvider } from "./components/theme-customizer";
import { BackgroundTaskNoticeHost } from "./components/ui/background-task-notice-host";
import { Toaster } from "./components/ui/toaster";
import { Layout } from "./components/layout";
import { StudentLayout } from "./components/student-layout";
import { useBrand } from "./lib/brand";

import { ENTERPRISE_ROLES, getHomeRoute, STUDENT_ROLES, TEACHER_ROLES } from "@/utils/role-routing";

function lazyNamed<TModule extends Record<string, unknown>, TExport extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TExport,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType };
  });
}

function RouteFallback() {
  return (
    <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
      页面加载中...
    </div>
  );
}

function BrowserTitle() {
  const brand = useBrand();

  useEffect(() => {
    document.title = brand.browserTitle;
  }, [brand.browserTitle]);

  return null;
}

const LoginPage = lazyNamed(() => import("./pages/auth/login"), "LoginPage");
const RegisterPage = lazyNamed(() => import("./pages/auth/register"), "RegisterPage");
const ResetPasswordPage = lazyNamed(() => import("./pages/auth/reset-password"), "ResetPasswordPage");
const StudentForceChangePasswordPage = lazyNamed(
  () => import("./pages/auth/student-force-change-password"),
  "StudentForceChangePasswordPage",
);
const UserList = lazyNamed(() => import("./pages/admin/users/list"), "UserList");
const UserCreate = lazyNamed(() => import("./pages/admin/users/create"), "UserCreate");
const UserEdit = lazyNamed(() => import("./pages/admin/users/edit"), "UserEdit");
const QuestionList = lazyNamed(() => import("./pages/questions/list"), "QuestionList");
const QuestionCreate = lazyNamed(() => import("./pages/questions/create"), "QuestionCreate");
const QuestionEdit = lazyNamed(() => import("./pages/questions/edit"), "QuestionEdit");
const QuestionImportPage = lazyNamed(() => import("./pages/questions/import"), "QuestionImportPage");
const AIGeneratePage = lazyNamed(() => import("./pages/questions/ai-generate"), "AIGeneratePage");
const Dashboard = lazyNamed(() => import("./pages/dashboard"), "Dashboard");
const KnowledgeManagementPage = lazyNamed(() => import("./pages/knowledge"), "KnowledgeManagementPage");
const MyExams = lazyNamed(() => import("./pages/student/my-exams"), "MyExams");
const WrongAnswers = lazyNamed(() => import("./pages/student/wrong-answers"), "WrongAnswers");
const WrongAnswerDetailPage = lazyNamed(
  () => import("./pages/student/wrong-answer-detail"),
  "WrongAnswerDetailPage",
);
const StudentDashboard = lazyNamed(() => import("./pages/student/dashboard"), "StudentDashboard");
const ExamResultPage = lazyNamed(() => import("./pages/student/exam-result"), "ExamResultPage");
const TagList = lazyNamed(() => import("./pages/tags/list"), "TagList");
const ExamList = lazyNamed(() => import("./pages/exams/list"), "ExamList");
const ExamCreate = lazyNamed(() => import("./pages/exams/create"), "ExamCreate");
const ExamEdit = lazyNamed(() => import("./pages/exams/edit"), "ExamEdit");
const PracticeCreate = lazyNamed(() => import("./pages/exams/practice-create"), "PracticeCreate");
const ExamStudentsPage = lazyNamed(() => import("./pages/exams/students"), "ExamStudentsPage");
const StudentAnswerPage = lazyNamed(() => import("./pages/exams/student-answer"), "StudentAnswerPage");
const ExamAnalysisPage = lazyNamed(() => import("./pages/exams/analysis"), "ExamAnalysisPage");
const ExamPaperViewPage = lazyNamed(() => import("./pages/exams/view"), "ExamPaperViewPage");
const PaperListPage = lazyNamed(() => import("./pages/papers/list"), "PaperListPage");
const PaperDetailPage = lazyNamed(() => import("./pages/papers/detail"), "PaperDetailPage");
const PaperImportPage = lazyNamed(() => import("./pages/papers/import"), "PaperImportPage");
const ExamTaking = lazyNamed(() => import("./pages/student/exam-taking"), "ExamTaking");
const EditorPage = lazyNamed(() => import("./pages/job-models/editor"), "EditorPage");
const JobModelList = lazyNamed(() => import("./pages/job-models/list"), "JobModelList");
const JobModelCreate = lazyNamed(() => import("./pages/job-models/create"), "JobModelCreate");
const JobModelFastCreate = lazyNamed(() => import("./pages/job-models/fast-create"), "JobModelFastCreate");
const StandardLibraryPage = lazyNamed(
  () => import("./pages/job-models/standard-library"),
  "StandardLibraryPage",
);
const JobModelUploadAI = lazyNamed(() => import("./pages/job-models/upload-ai"), "JobModelUploadAI");
const ModelConfigPage = lazyNamed(() => import("./pages/settings/model-config"), "ModelConfigPage");
const GradingCenterPage = lazyNamed(() => import("./pages/grading"), "GradingCenterPage");
const OperationsRegradingPage = lazyNamed(() => import("./pages/operations/regrading"), "OperationsRegradingPage");
const OperationsActivityLogsPage = lazyNamed(
  () => import("./pages/operations/activity-logs"),
  "OperationsActivityLogsPage",
);
const GwmxLanding = lazyNamed(() => import("./pages/gwmx/landing"), "GwmxLanding");
const GwmxWorkbench = lazyNamed(() => import("./pages/gwmx/workbench"), "GwmxWorkbench");
const CandidateLanding = lazyNamed(() => import("./pages/exam-invite/landing"), "CandidateLanding");
const CandidatePublicLanding = lazyNamed(() => import("./pages/exam-invite/public-landing"), "CandidatePublicLanding");
const GuestExamTakePage = lazyNamed(() => import("./pages/exam-invite/take"), "GuestExamTakePage");
const CandidateDonePage = lazyNamed(() => import("./pages/exam-invite/done"), "CandidateDonePage");
const StudentManagementPage = lazy(() => import("./pages/students"));

/** Redirect users to their home route if they don't match the allowed roles */
function RoleGuard({ allow }: { allow: string[] }) {
  const { data: identity, isLoading } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  if (isLoading) return null;
  const role = identity ? getUserRole(identity) : "";
  if (!allow.includes(role)) return <Navigate to={getHomeRoute(role)} replace />;
  return <Outlet />;
}

/** Index route: role-based redirect */
function HomeRedirect() {
  const { data: identity, isLoading } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  if (isLoading) return null;
  const role = identity ? getUserRole(identity) : "";
  const target = getHomeRoute(role);
  if (target !== "/dashboard") return <Navigate to={target} replace />;
  return <Dashboard />;
}

/** After login redirect: role-based */
function LoginSuccessRedirect() {
  const { data: identity, isLoading } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  if (isLoading) return null;
  const role = identity ? getUserRole(identity) : "";
  return <Navigate to={getHomeRoute(role)} replace />;
}

/** Blocks student routes when must_change_password is true */
function StudentForcePasswordGuard() {
  const userStr = localStorage.getItem("user");
  const user = userStr ? (JSON.parse(userStr) as { must_change_password?: boolean }) : null;
  if (user?.must_change_password) return <Navigate to="/student/force-change-password" replace />;
  return <Outlet />;
}

function App() {
  return (
    <ThemeProvider>
      <ThemeConfigProvider>
        <BrowserRouter>
          <BrowserTitle />
          <Refine
            routerProvider={routerProvider}
            dataProvider={dataProvider}
            authProvider={authProvider}
            accessControlProvider={accessControlProvider}
            resources={[
              {
                name: "users",
                list: "/users",
                create: "/users/create",
                edit: "/users/edit/:id",
                meta: { label: "Users" },
              },
              {
                name: "questions",
                list: "/questions",
                create: "/questions/create",
                edit: "/questions/edit/:id",
                meta: { label: "Questions" },
              },
              {
                name: "tags",
                list: "/tags",
                meta: { label: "Tags" },
              },
              {
                name: "exams",
                list: "/exams",
                create: "/exams/create",
                edit: "/exams/edit/:id",
                meta: { label: "考试管理" },
              },
              {
                name: "papers",
                list: "/papers",
                create: "/papers/import",
                meta: { label: "试卷列表" },
              },
              {
                name: "knowledge",
                list: "/knowledge",
                meta: { label: "知识点管理" },
              },
              {
                name: "job-models",
                list: "/gwmx/job-models",
                meta: { label: "职位模型管理" },
              },
              {
                name: "grading",
                list: "/grading",
                meta: { label: "阅卷中心" },
              },
              {
                name: "operations",
                list: "/operations",
                meta: { label: "运营管理" },
              },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
            }}
          >
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* External candidate routes — public, no application shell */}
                <Route path="/exam-invite" element={<CandidateLanding />} />
                <Route path="/exam-public" element={<CandidatePublicLanding />} />
                <Route path="/exam-invite/take/:examId" element={<GuestExamTakePage />} />
                <Route path="/exam-invite/done" element={<CandidateDonePage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Student first-login force-change-password — authenticated, no sidebar */}
                <Route
                  path="/student/force-change-password"
                  element={
                    <Authenticated key="student-force-pwd" fallback={<CatchAllNavigate to="/login" />}>
                      <StudentForceChangePasswordPage />
                    </Authenticated>
                  }
                />

                {/* Student routes — sidebar layout, students only */}
                <Route
                  element={
                    <Authenticated key="student-auth" fallback={<CatchAllNavigate to="/login" />}>
                      <RoleGuard allow={STUDENT_ROLES} />
                    </Authenticated>
                  }
                >
                  <Route element={<StudentForcePasswordGuard />}>
                    <Route element={<StudentLayout />}>
                      <Route path="/student" element={<StudentDashboard />} />
                      <Route path="/my-exams" element={<MyExams />} />
                      <Route path="/my-exams/:id/result" element={<ExamResultPage />} />
                      <Route path="/wrong-answers" element={<WrongAnswers />} />
                      <Route path="/wrong-answers/:id" element={<WrongAnswerDetailPage />} />
                    </Route>
                  </Route>
                </Route>

                {/* Admin/Teacher routes — top nav layout */}
                <Route
                  element={
                    <Authenticated key="auth" fallback={<CatchAllNavigate to="/login" />}>
                      <RoleGuard allow={TEACHER_ROLES} />
                    </Authenticated>
                  }
                >
                  <Route element={<Layout />}>
                    <Route index element={<HomeRedirect />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/users">
                      <Route index element={<UserList />} />
                      <Route path="create" element={<UserCreate />} />
                      <Route path="edit/:id" element={<UserEdit />} />
                    </Route>
                    <Route path="/questions">
                      <Route index element={<QuestionList />} />
                      <Route path="create" element={<QuestionCreate />} />
                      <Route path="import" element={<QuestionImportPage />} />
                      <Route path="ai-generate" element={<AIGeneratePage />} />
                      <Route path="edit/:id" element={<QuestionEdit />} />
                    </Route>
                    <Route path="/exams">
                      <Route index element={<ExamList />} />
                      <Route path="create" element={<ExamCreate />} />
                      <Route path="practice/create" element={<PracticeCreate />} />
                      <Route path="practice/edit/:id" element={<PracticeCreate />} />
                      <Route path=":id/view" element={<ExamPaperViewPage />} />
                      <Route path=":id/analysis" element={<ExamAnalysisPage />} />
                      <Route path="edit/:id" element={<ExamEdit />} />
                      <Route path="students" element={<ExamStudentsPage />} />
                      <Route path=":examId/students/:studentId/result" element={<StudentAnswerPage />} />
                    </Route>
                    <Route path="/papers">
                      <Route index element={<PaperListPage />} />
                      <Route path="import" element={<PaperImportPage />} />
                      <Route path=":id" element={<PaperDetailPage />} />
                    </Route>
                    <Route path="/tags" element={<TagList />} />
                    <Route path="/knowledge" element={<KnowledgeManagementPage />} />
                    <Route path="/grading" element={<GradingCenterPage />} />
                    <Route element={<RoleGuard allow={["platform_admin"]} />}>
                      <Route path="/operations" element={<Navigate to="/operations/regrading" replace />} />
                      <Route path="/operations/regrading" element={<OperationsRegradingPage />} />
                      <Route path="/operations/activity-logs" element={<OperationsActivityLogsPage />} />
                    </Route>
                    <Route path="/students" element={<StudentManagementPage />} />
                    <Route path="/settings/model" element={<ModelConfigPage />} />
                  </Route>
                </Route>

                {/* GWMX landing page — public */}
                <Route path="/gwmx" element={<GwmxLanding />} />

                {/* GWMX authenticated routes */}
                <Route
                  element={
                    <Authenticated key="gwmx-auth" fallback={<Navigate to="/login?brand=gwmx" replace />}>
                      <RoleGuard allow={ENTERPRISE_ROLES} />
                    </Authenticated>
                  }
                >
                  <Route element={<Layout />}>
                    <Route path="/gwmx/workbench" element={<GwmxWorkbench />} />
                    <Route path="/gwmx/job-models" element={<JobModelList />} />
                    <Route path="/gwmx/job-models/standard-library" element={<StandardLibraryPage />} />
                    <Route path="/gwmx/job-models/create" element={<JobModelCreate />} />
                    <Route path="/gwmx/job-models/fast-create" element={<JobModelFastCreate />} />
                    <Route path="/gwmx/job-models/upload-ai" element={<JobModelUploadAI />} />
                  </Route>
                </Route>

                {/* Job model editor — full-screen, no Layout wrapper */}
                <Route
                  path="/gwmx/job-models/:jobModelId/versions/:versionId/editor"
                  element={
                    <Authenticated key="editor" fallback={<Navigate to="/login?brand=gwmx" replace />}>
                      <RoleGuard allow={ENTERPRISE_ROLES} />
                    </Authenticated>
                  }
                >
                  <Route index element={<EditorPage />} />
                </Route>

                {/* Exam taking — full-screen, no Layout wrapper */}
                <Route
                  element={
                    <Authenticated key="exam-taking" fallback={<CatchAllNavigate to="/login" />}>
                      <StudentForcePasswordGuard />
                    </Authenticated>
                  }
                >
                  <Route path="/my-exams/:id/take" element={<ExamTaking />} />
                </Route>

                <Route
                  element={
                    <Authenticated key="auth" fallback={<Outlet />}>
                      <LoginSuccessRedirect />
                    </Authenticated>
                  }
                >
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                </Route>
              </Routes>
            </Suspense>
          </Refine>
          <BackgroundTaskNoticeHost />
          <Toaster />
        </BrowserRouter>
      </ThemeConfigProvider>
    </ThemeProvider>
  );
}

export default App;
