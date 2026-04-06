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
import { Layout } from "./components/layout";
import { StudentLayout } from "./components/student-layout";
import { LoginPage } from "./pages/auth/login";
import { UserList } from "./pages/admin/users/list";
import { UserCreate } from "./pages/admin/users/create";
import { UserEdit } from "./pages/admin/users/edit";
import { QuestionList } from "./pages/questions/list";
import { QuestionCreate } from "./pages/questions/create";
import { QuestionEdit } from "./pages/questions/edit";
import { QuestionImportPage } from "./pages/questions/import";
import { Dashboard } from "./pages/dashboard";
import { KnowledgeManagementPage } from "./pages/knowledge";
import { MyExams } from "./pages/student/my-exams";
import { WrongAnswers } from "./pages/student/wrong-answers";
import { StudentDashboard } from "./pages/student/dashboard";
import { TagList } from "./pages/tags/list";
import { ExamList } from "./pages/exams/list";
import { ExamCreate } from "./pages/exams/create";
import { ExamEdit } from "./pages/exams/edit";
import { ExamTaking } from "./pages/student/exam-taking";
import { EditorPage } from "./pages/job-models/editor"
import { JobModelList } from "./pages/job-models/list"
import { JobModelCreate } from "./pages/job-models/create"
import { JobModelUploadAI } from "./pages/job-models/upload-ai";
import { GradingAnalyticsPage } from "./pages/grading/analytics";
import { GradingCenterPage } from "./pages/grading";

/** Index route: students → /student, everyone else → dashboard */
function HomeRedirect() {
  const { data: identity, isLoading } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  if (isLoading) return null;
  if (identity && getUserRole(identity) === "student") return <Navigate to="/student" replace />;
  return <Dashboard />;
}

/** After login redirect: students → /student, everyone else → / */
function LoginSuccessRedirect() {
  const { data: identity, isLoading } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  if (isLoading) return null;
  if (identity && getUserRole(identity) === "student") return <Navigate to="/student" replace />;
  return <Navigate to="/" replace />;
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
              list: "/job-models",
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
            {/* Student routes — sidebar layout */}
            <Route
              element={
                <Authenticated key="student-auth" fallback={<CatchAllNavigate to="/login" />}>
                  <StudentLayout />
                </Authenticated>
              }
            >
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/my-exams" element={<MyExams />} />
              <Route path="/wrong-answers" element={<WrongAnswers />} />
            </Route>

            {/* Admin/Teacher routes — top nav layout */}
            <Route
              element={
                <Authenticated key="auth" fallback={<CatchAllNavigate to="/login" />}>
                  <Layout />
                </Authenticated>
              }
            >
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
                <Route path="edit/:id" element={<QuestionEdit />} />
              </Route>
              <Route path="/exams">
                <Route index element={<ExamList />} />
                <Route path="create" element={<ExamCreate />} />
                <Route path="edit/:id" element={<ExamEdit />} />
              </Route>
              <Route path="/tags" element={<TagList />} />
              <Route path="/knowledge" element={<KnowledgeManagementPage />} />
              <Route path="/grading" element={<GradingCenterPage />} />
              <Route path="/grading/analytics" element={<GradingAnalyticsPage />} />
              <Route path="/job-models" element={<JobModelList />} />
              <Route path="/job-models/create" element={<JobModelCreate />} />
              <Route path="/job-models/upload-ai" element={<JobModelUploadAI />} />
            </Route>

            {/* Job model editor — full-screen, no Layout wrapper */}
            <Route
              path="/job-models/:projectId/models/:modelId/editor"
              element={
                <Authenticated key="editor" fallback={<CatchAllNavigate to="/login" />}>
                  <EditorPage />
                </Authenticated>
              }
            />

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
            </Route>
          </Routes>
        </Refine>
      </BrowserRouter>
      {import.meta.env.DEV && <Agentation />}
      </ThemeConfigProvider>
    </ThemeProvider>
  );
}

export default App;
