import { apiRequest } from "@/pages/grading/api";
import type { IQuestion, QuestionType } from "@/types";

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

export interface MaterialKnowledgeFragment {
  /** concept / term / formula / code_example / case / workflow / other */
  type: string;
  title: string;
  content: string;
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
  knowledge_fragments: MaterialKnowledgeFragment[];
  /** 知识库入库状态：processing / ready / failed；null = 未入库 */
  kb_status: string | null;
  kb_chunk_count: number;
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
  has_gradable_questions?: boolean;
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
  student_profile: Record<string, unknown> | null;
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
  student_profile?: Record<string, unknown> | null;
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
      student_profile: payload.student_profile ?? null,
    }),
  });
}

/** 课程成绩权重（百分比）。当前版本：章节任务点 / 章节测试 / 作业 / 考试。 */
export interface CourseGradeWeights {
  chapter_task: number;
  chapter_quiz: number;
  assignment: number;
  exam: number;
}

export function getCourseGradeWeights(courseId: string) {
  return apiRequest<CourseGradeWeights>(`/teacher/courses/${courseId}/grade-weights`);
}

export function updateCourseGradeWeights(courseId: string, weights: CourseGradeWeights) {
  return apiRequest<CourseGradeWeights>(`/teacher/courses/${courseId}/grade-weights`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(weights),
  });
}

export type CourseGradeComponentKey =
  | "chapter_task"
  | "chapter_quiz"
  | "assignment"
  | "exam";

export interface CourseGradeComponent {
  score: number | null;
  system_score: number | null;
  manual_score: number | null;
  source: "system" | "manual" | "none";
}

export interface CourseGradeClass {
  id: string;
  name: string;
  student_count: number;
}

export interface CourseGradeStudent {
  student_id: string;
  student_no: string | null;
  full_name: string | null;
  username: string | null;
  class_id: string;
  class_name: string;
  chapter_task: CourseGradeComponent;
  chapter_quiz: CourseGradeComponent;
  assignment: CourseGradeComponent;
  exam: CourseGradeComponent;
  comprehensive_score: number;
}

export interface CourseGradeSummary {
  course_id: string;
  semester_id: string | null;
  weights: CourseGradeWeights;
  class_average_score: number | null;
  student_count: number;
  classes: CourseGradeClass[];
  distribution: {
    excellent: number;
    passing: number;
    needs_attention: number;
  };
  students: CourseGradeStudent[];
  generated_at: string;
}

export function getCourseGradeSummary(courseId: string, semesterId?: string | null) {
  return apiRequest<CourseGradeSummary>(
    `/teacher/courses/${courseId}/grade-summary${semesterQuery(semesterId)}`,
  );
}

export interface CourseMasteryUnit {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  depth: number;
  is_leaf: boolean;
  question_count: number;
  attempt_count: number;
  score_total: number;
  max_score_total: number;
  accuracy: number | null;
  practice_accuracy: number | null;
  exam_accuracy: number | null;
  trend_delta: number | null;
  variance: number | null;
  sample_insufficient: boolean;
}

export interface CourseMasteryQuestion {
  id: string;
  title: string;
  question_type: string;
  unit_id: string | null;
  unit_name: string | null;
  attempt_count: number;
  score_total: number;
  max_score_total: number;
  accuracy: number | null;
  discrimination: number | null;
}

export interface CourseMasteryMatrixCell {
  unit_id: string;
  accuracy: number | null;
  practice_accuracy: number | null;
  exam_accuracy: number | null;
  trend_delta: number | null;
  attempt_count: number;
  sample_insufficient: boolean;
}

export interface CourseMasteryStudent {
  student_id: string;
  student_no: string | null;
  full_name: string | null;
  username: string | null;
  class_name: string | null;
  average_accuracy: number | null;
  weak_units: string[];
  consistency_alerts: string[];
  cluster_label: string | null;
  cells: CourseMasteryMatrixCell[];
}

export interface CourseMasterySummary {
  course_id: string;
  semester_id: string | null;
  sample_threshold: number;
  student_count: number;
  question_count: number;
  overall_accuracy: number | null;
  units: CourseMasteryUnit[];
  questions: CourseMasteryQuestion[];
  matrix_columns: CourseMasteryUnit[];
  students: CourseMasteryStudent[];
  generated_at: string;
}

export function getCourseMasterySummary(courseId: string, semesterId?: string | null) {
  return apiRequest<CourseMasterySummary>(
    `/teacher/courses/${courseId}/mastery-summary${semesterQuery(semesterId)}`,
  );
}

export function updateCourseStudentGrade(
  courseId: string,
  studentId: string,
  payload: {
    semester_id: string | null;
    component: CourseGradeComponentKey;
    score: number | null;
  },
) {
  return apiRequest<{
    student_id: string;
    semester_id: string | null;
    component: CourseGradeComponentKey;
    manual_score: number | null;
  }>(`/teacher/courses/${courseId}/grade-summary/${studentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** 更新某个学期关联的班级（从学生管理的班级列表里选择）。 */
export function updateCourseSemesterClasses(
  courseId: string,
  semesterId: string,
  classIds: string[],
) {
  return apiRequest<CourseSemester>(
    `/teacher/courses/${courseId}/semesters/${semesterId}/classes`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_ids: classIds }),
    },
  );
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

export interface CourseQuestionListParams {
  page?: number;
  page_size?: number;
  knowledge_point_id?: string | null;
  types?: QuestionType[];
  q?: string;
}

export interface CourseQuestionListResponse {
  items: IQuestion[];
  total: number;
  type_counts: Partial<Record<QuestionType, number>>;
}

export function listCourseQuestionsPaginated(
  courseId: string,
  params: CourseQuestionListParams = {},
) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  if (params.knowledge_point_id) {
    search.set("knowledge_point_id", params.knowledge_point_id);
  }
  if (params.types?.length) {
    for (const type of params.types) {
      search.append("types", type);
    }
  }
  if (params.q) search.set("q", params.q);
  return apiRequest<CourseQuestionListResponse>(
    `/teacher/courses/${courseId}/questions/paginated?${search.toString()}`,
  );
}

export function clearCourseQuestions(courseId: string) {
  return apiRequest<{
    deleted: number;
    hard_deleted: number;
    soft_deleted: number;
  }>(`/teacher/courses/${courseId}/questions`, { method: "DELETE" });
}

export interface CourseQuestionKnowledgeCompletionJob {
  job_id: string;
  total_count: number;
  question_ids: string[];
}

export function completeCourseQuestionKnowledge(courseId: string, questionIds: string[]) {
  return apiRequest<CourseQuestionKnowledgeCompletionJob>(
    `/teacher/courses/${courseId}/questions/complete-knowledge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_ids: questionIds }),
    },
  );
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

export interface CourseKnowledgeReorderPayload {
  /** 目标父节点 id。 */
  parent_id: string;
  /** 目标父节点下重排后的完整同级顺序。 */
  ordered_ids: string[];
}

export function reorderCourseKnowledgePoint(
  nodeId: string,
  payload: CourseKnowledgeReorderPayload,
) {
  return apiRequest<{ id: string; name: string; parent_id: string }>(
    `/knowledge/knowledge-points/${nodeId}/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export { exportExam, type ExamExportFormat } from "@/lib/exam-export";
