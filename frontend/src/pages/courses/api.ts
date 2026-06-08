import { apiRequest } from "@/pages/grading/api";
import type { IQuestion } from "@/types";

/**
 * Dedupe concurrent GETs to the same URL. React 19 StrictMode + lazy + Suspense
 * can mount this page up to 4 times during the first paint, and each mount
 * fires its own useEffect → 4 identical /teacher/courses requests on the wire.
 * Sharing a single in-flight Promise collapses them into one network call.
 *
 * Cache is in-flight only — the entry is dropped the moment the promise
 * settles, so subsequent navigations still get fresh data.
 */
const inFlight = new Map<string, Promise<unknown>>();

function dedupedGet<T>(path: string): Promise<T> {
  const existing = inFlight.get(path);
  if (existing) return existing as Promise<T>;
  const promise = apiRequest<T>(path).finally(() => {
    inFlight.delete(path);
  });
  inFlight.set(path, promise);
  return promise;
}

export interface TeacherCourseSummary {
  id: string;
  name: string;
  description: string | null;
  major_id: string | null;
  major_name: string | null;
  direction_id: string | null;
  direction_name: string | null;
  display_path: string;
  is_major_direct: boolean;
  owner_id: string | null;
  visibility: "private" | "platform";
  can_write: boolean;
  material_count: number;
  exam_count: number;
  assignment_count: number;
  question_count: number;
  pending_count: number;
  updated_at: string;
  deleted_at: string | null;
  is_deleted: boolean;
}

export interface TeacherCourseDetail extends TeacherCourseSummary {
  tags: string[];
  difficulty: string | null;
}

export interface TeacherCourseMaterial {
  id: string;
  node_id: string;
  node_name: string | null;
  resource_type: string;
  title: string;
  url: string | null;
  description: string | null;
  source: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeacherCourseExamKnowledgePoint {
  id: string;
  name: string;
}

export interface TeacherCourseExam {
  id: string;
  category: "exam" | "practice" | string;
  course_kp_id: string | null;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  status: "draft" | "upcoming" | "ongoing" | "completed" | "closed" | string;
  total_questions: number;
  total_score: number;
  total_students: number;
  submitted_count: number;
  pending_count: number;
  has_student_history: boolean;
  knowledge_points: TeacherCourseExamKnowledgePoint[];
  semester_id: string | null;
  semester_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseAssignmentScoreColumn {
  id: string;
  title: string;
  total_score: number;
  submitted_count: number;
  total_students: number;
  semester_id: string | null;
  semester_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface CourseAssignmentScoreCell {
  assignment_id: string;
  assigned: boolean;
  score: number | null;
  percent: number | null;
  submitted_at: string | null;
  grading_status: string | null;
}

export interface CourseAssignmentScoreStudent {
  student_id: string;
  student_no: string | null;
  full_name: string | null;
  username: string | null;
  phone: string | null;
  submitted_count: number;
  assignment_count: number;
  total_score: number;
  max_score: number;
  average_percent: number | null;
  cells: CourseAssignmentScoreCell[];
}

export interface CourseAssignmentScoreSummary {
  course_id: string;
  semester_id: string | null;
  assignment_count: number;
  student_count: number;
  class_average_percent: number | null;
  assignments: CourseAssignmentScoreColumn[];
  students: CourseAssignmentScoreStudent[];
  generated_at: string;
}

export interface CourseSemester {
  id: string;
  course_id: string;
  name: string;
  description: string | null;
  semester_major_label: string | null;
  semester_major_description: string | null;
  class_ids: string[];
  start_date: string | null;
  end_date: string | null;
  exam_count: number;
  assignment_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSemesterPayload {
  name: string;
  description?: string | null;
  semester_major_label?: string | null;
  semester_major_description?: string | null;
  class_ids?: string[];
  start_date?: string | null;
  end_date?: string | null;
}

export interface CreateTeacherCoursePayload {
  name: string;
  description?: string | null;
}

export function listTeacherCourses() {
  return dedupedGet<TeacherCourseSummary[]>("/teacher/courses");
}

export function createTeacherCourse(payload: CreateTeacherCoursePayload) {
  return apiRequest<TeacherCourseSummary>("/teacher/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? null,
    }),
  });
}

export function deleteTeacherCourse(courseId: string) {
  return apiRequest<void>(`/teacher/courses/${courseId}`, {
    method: "DELETE",
  });
}

export function getTeacherCourse(courseId: string, semesterId?: string | null) {
  return dedupedGet<TeacherCourseDetail>(`/teacher/courses/${courseId}${semesterQuery(semesterId)}`);
}

export function listCourseMaterials(courseId: string) {
  return dedupedGet<TeacherCourseMaterial[]>(`/teacher/courses/${courseId}/materials`);
}

function semesterQuery(semesterId: string | null | undefined): string {
  return semesterId ? `?semester_id=${encodeURIComponent(semesterId)}` : "";
}

export function listCourseExams(courseId: string, semesterId?: string | null) {
  return dedupedGet<TeacherCourseExam[]>(
    `/teacher/courses/${courseId}/exams${semesterQuery(semesterId)}`,
  );
}

export function listCourseAssignments(courseId: string, semesterId?: string | null) {
  return dedupedGet<TeacherCourseExam[]>(
    `/teacher/courses/${courseId}/assignments${semesterQuery(semesterId)}`,
  );
}

export function getCourseAssignmentScoreSummary(courseId: string, semesterId?: string | null) {
  return dedupedGet<CourseAssignmentScoreSummary>(
    `/teacher/courses/${courseId}/assignment-score-summary${semesterQuery(semesterId)}`,
  );
}

export function listCourseSemesters(courseId: string) {
  return dedupedGet<CourseSemester[]>(`/teacher/courses/${courseId}/semesters`);
}

export function createCourseSemester(courseId: string, payload: CreateSemesterPayload) {
  return apiRequest<CourseSemester>(`/teacher/courses/${courseId}/semesters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? null,
      semester_major_label: payload.semester_major_label ?? null,
      semester_major_description: payload.semester_major_description ?? null,
      class_ids: payload.class_ids ?? [],
      start_date: payload.start_date ?? null,
      end_date: payload.end_date ?? null,
    }),
  });
}

/** Add an external link material to a knowledge-point node (course or subnode).
 *  Reuses the existing job-models LearningResource endpoint that powers the
 *  knowledge management page. */
export function addCourseMaterialLink(
  nodeId: string,
  payload: { title: string; url: string; description?: string | null },
) {
  return apiRequest<TeacherCourseMaterial>(
    `/job-models/models/nodes/${nodeId}/resources?node_type=kp`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource_type: "link",
        title: payload.title,
        url: payload.url,
        description: payload.description ?? null,
        source: "manual",
      }),
    },
  );
}

export function updateCourseMaterial(
  resourceId: string,
  payload: {
    node_id?: string;
    title?: string;
    url?: string | null;
    description?: string | null;
  },
) {
  return apiRequest<TeacherCourseMaterial>(`/job-models/models/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Multipart upload — fetch directly because apiRequest assumes JSON body. */
export async function uploadCourseMaterialFile(nodeId: string, file: File): Promise<TeacherCourseMaterial> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", file.name);
  formData.append("node_type", "kp");
  const token = localStorage.getItem("access_token");
  const response = await fetch(
    `/api/job-models/models/nodes/${nodeId}/resources/upload`,
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.detail ?? "上传文件失败");
  }
  return (await response.json()) as TeacherCourseMaterial;
}

export function deleteCourseMaterial(resourceId: string) {
  return apiRequest<void>(`/job-models/models/resources/${resourceId}`, {
    method: "DELETE",
  });
}

export function clearCourseKnowledgePoints(courseId: string) {
  return apiRequest<{ deleted: number }>(
    `/teacher/courses/${courseId}/knowledge-points`,
    { method: "DELETE" },
  );
}

export function archiveExamToSemester(
  courseId: string,
  examId: string,
  semesterId: string | null,
) {
  return apiRequest<TeacherCourseExam>(
    `/teacher/courses/${courseId}/exams/${examId}/archive`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ semester_id: semesterId }),
    },
  );
}

export function listCourseQuestions(courseId: string) {
  // 题目 tab 会一次性加载课程全部题目，再在前端按知识点/搜索过滤，
  // 因此需要请求足够大的上限覆盖整门课程的题量（避免按知识点筛选时漏题）。
  return dedupedGet<IQuestion[]>(`/teacher/courses/${courseId}/questions?limit=5000`);
}

export function clearCourseQuestions(courseId: string) {
  return apiRequest<{
    deleted: number;
    hard_deleted: number;
    soft_deleted: number;
  }>(`/teacher/courses/${courseId}/questions`, { method: "DELETE" });
}

export interface CourseKnowledgeNode {
  id: string;
  name: string;
  question_count: number;
  material_count: number;
  children: CourseKnowledgeNode[];
}

export function getCourseKnowledgeTree(courseId: string) {
  return dedupedGet<CourseKnowledgeNode>(`/teacher/courses/${courseId}/knowledge-tree`);
}

export function updateCourseKnowledgePointName(nodeId: string, name: string) {
  return apiRequest<{ id: string; name: string }>(`/knowledge/knowledge-points/${nodeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export { exportExam, type ExamExportFormat } from "@/lib/exam-export";
