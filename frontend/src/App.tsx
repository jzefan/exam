import { Agentation } from "agentation";
import { Refine, Authenticated, useGetIdentity } from "@refinedev/core";
import routerProvider, {
  CatchAllNavigate,
} from "@refinedev/react-router";
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
import { LoginPage } from "./pages/auth/login";
import { RegisterPage } from "./pages/auth/register";
import { UserList } from "./pages/admin/users/list";
import { UserCreate } from "./pages/admin/users/create";
import { UserEdit } from "./pages/admin/users/edit";
import { QuestionList } from "./pages/questions/list";
import { QuestionCreate } from "./pages/questions/create";
import { QuestionEdit } from "./pages/questions/edit";
import { QuestionImportPage } from "./pages/questions/import";
import { AIGeneratePage } from "./pages/questions/ai-generate";
import { Dashboard } from "./pages/dashboard";
import { KnowledgeManagementPage } from "./pages/knowledge";
import { MyExams } from "./pages/student/my-exams";
import { WrongAnswers } from "./pages/student/wrong-answers";
import { WrongAnswerDetailPage } from "./pages/student/wrong-answer-detail";
import { StudentDashboard } from "./pages/student/dashboard";
import { ExamResultPage } from "./pages/student/exam-result";
import { TagList } from "./pages/tags/list";
import { ExamList } from "./pages/exams/list";
import { ExamCreate } from "./pages/exams/create";
import { ExamEdit } from "./pages/exams/edit";
import { PracticeCreate } from "./pages/exams/practice-create";
import { ExamStudentsPage } from "./pages/exams/students";
import { ExamAnalysisPage } from "./pages/exams/analysis";
import { ExamPaperViewPage } from "./pages/exams/view";
import { ExamTaking } from "./pages/student/exam-taking";
import { EditorPage } from "./pages/job-models/editor"
import { JobModelList } from "./pages/job-models/list"
import { JobModelCreate } from "./pages/job-models/create"
import { JobModelFastCreate } from "./pages/job-models/fast-create";
import { StandardLibraryPage } from "./pages/job-models/standard-library";
import { JobModelUploadAI } from "./pages/job-models/upload-ai";
import { ModelConfigPage } from "./pages/settings/model-config";
import { GradingCenterPage } from "./pages/grading";
import { GwmxLanding } from "./pages/gwmx/landing";
import { GwmxWorkbench } from "./pages/gwmx/workbench";
import StudentManagementPage from "./pages/students";

import { ENTERPRISE_ROLES, getHomeRoute, TEACHER_ROLES } from "@/utils/role-routing";

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

function App() {
  return (
    <ThemeProvider>
      <ThemeConfigProvider>
      <BrowserRouter>
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
          ]}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: true,
          }}
        >
          <Routes>
            {/* Student routes — sidebar layout, students only */}
            <Route
              element={
                <Authenticated key="student-auth" fallback={<CatchAllNavigate to="/login" />}>
                  <RoleGuard allow={["student"]} />
                </Authenticated>
              }
            >
              <Route element={<StudentLayout />}>
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/my-exams" element={<MyExams />} />
                <Route path="/my-exams/:id/result" element={<ExamResultPage />} />
                <Route path="/wrong-answers" element={<WrongAnswers />} />
                <Route path="/wrong-answers/:id" element={<WrongAnswerDetailPage />} />
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
                </Route>
                <Route path="/tags" element={<TagList />} />
                <Route path="/knowledge" element={<KnowledgeManagementPage />} />
                <Route path="/grading" element={<GradingCenterPage />} />
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
              path="/my-exams/:id/take"
              element={
                <Authenticated key="exam-taking" fallback={<CatchAllNavigate to="/login" />}>
                  <ExamTaking />
                </Authenticated>
              }
            />

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
        </Refine>
        <BackgroundTaskNoticeHost />
        <Toaster />
      </BrowserRouter>
      {import.meta.env.DEV && <Agentation />}
      </ThemeConfigProvider>
    </ThemeProvider>
  );
}

export default App;
