import type {
  GradingCandidateDetailResponse,
  GradingInboxResponse,
  GradingQuestionDetailResponse,
} from "./api";

/**
 * In-memory mock handlers for the grading endpoints used by GradingCenterPage.
 *
 * The page funnels every request through `apiRequest(path, init)`, so a test can
 * mock that single function and delegate to {@link createGradingApiHandler} to
 * get realistic responses for:
 *   - GET  /grading/inbox
 *   - GET  /grading/inbox/questions/:examKey/:questionId
 *   - GET  /grading/inbox/tasks/:taskId
 *   - POST /grading/tasks/:taskId/viewed   (mark-as-viewed side effect)
 *
 * One exam ("Java 后端期中考试") with two questions and two candidates (张三 /
 * 李四) — enough to exercise both 「按题目阅卷」 and 「按考生阅卷」 modes.
 */

const EXAM_ID = "exam-1";
const EXAM_LABEL = "Java 后端期中考试";
const EXAM_DATE = "2026-06-01T00:00:00.000Z";

export const inboxFixture: GradingInboxResponse = {
  exams: [
    {
      exam_id: EXAM_ID,
      exam_label: EXAM_LABEL,
      exam_date: EXAM_DATE,
      questions: [
        {
          question_key: `${EXAM_ID}::q-1`,
          question_id: "q-1",
          question_label: "简答题 1",
          question_type: "short_answer",
          question_content: "请解释 JVM 内存模型的组成。",
          max_score: 10,
          knowledge_tags: ["JVM"],
          pending_count: 2,
          completed_count: 0,
          candidate_count: 2,
          latest_updated_at: "2026-06-02T08:00:00.000Z",
        },
        {
          question_key: `${EXAM_ID}::q-2`,
          question_id: "q-2",
          question_label: "代码题 2",
          question_type: "code",
          question_content: "实现一个线程安全的单例模式。",
          max_score: 15,
          knowledge_tags: ["并发编程"],
          pending_count: 2,
          completed_count: 0,
          candidate_count: 2,
          latest_updated_at: "2026-06-02T08:00:00.000Z",
        },
      ],
    },
  ],
};

function questionDetail(
  questionId: "q-1" | "q-2",
  overrides: Pick<
    GradingQuestionDetailResponse,
    "question_label" | "question_type" | "question_content" | "max_score" | "knowledge_tags"
  >,
  tasks: Array<{ taskId: string; candidateName: string; candidateCode: string }>,
): GradingQuestionDetailResponse {
  return {
    exam_id: EXAM_ID,
    exam_label: EXAM_LABEL,
    exam_date: EXAM_DATE,
    question_key: `${EXAM_ID}::${questionId}`,
    question_id: questionId,
    ...overrides,
    candidates: tasks.map(({ taskId, candidateName, candidateCode }) => ({
      task_id: taskId,
      candidate_name: candidateName,
      candidate_code: candidateCode,
      student_id: null,
      status: "待确认",
      score: null,
      arbitration_required: false,
      manual_override: false,
      viewed: false,
    })),
  };
}

export const questionDetailFixtures: Record<string, GradingQuestionDetailResponse> = {
  "q-1": questionDetail(
    "q-1",
    {
      question_label: "简答题 1",
      question_type: "short_answer",
      question_content: "请解释 JVM 内存模型的组成。",
      max_score: 10,
      knowledge_tags: ["JVM"],
    },
    [
      { taskId: "task-q1-a", candidateName: "张三", candidateCode: "A-101" },
      { taskId: "task-q1-b", candidateName: "李四", candidateCode: "B-208" },
    ],
  ),
  "q-2": questionDetail(
    "q-2",
    {
      question_label: "代码题 2",
      question_type: "code",
      question_content: "实现一个线程安全的单例模式。",
      max_score: 15,
      knowledge_tags: ["并发编程"],
    },
    [
      { taskId: "task-q2-a", candidateName: "张三", candidateCode: "A-101" },
      { taskId: "task-q2-b", candidateName: "李四", candidateCode: "B-208" },
    ],
  ),
};

function candidateDetail(
  base: Pick<
    GradingCandidateDetailResponse,
    "task_id" | "candidate_name" | "candidate_code" | "question_type" | "max_score" | "suggested_score" | "student_answer_raw" | "knowledge_tags"
  >,
  models: GradingCandidateDetailResponse["models"],
): GradingCandidateDetailResponse {
  return {
    ...base,
    status: "待确认",
    viewed: false,
    evaluation_note: null,
    attachment_refs: [],
    feedback: {
      dimensions: [
        { name: "answer_point_coverage", score: 4, max_score: 5, comment: "覆盖了主要知识点。" },
      ],
      strengths: [],
      deductions: [],
      suggestions: [],
      risk_flags: [],
      evidence_lines: [],
    },
    models,
    follow_ups: [],
  };
}

export const candidateDetailFixtures: Record<string, GradingCandidateDetailResponse> = {
  "task-q1-a": candidateDetail(
    {
      task_id: "task-q1-a",
      candidate_name: "张三",
      candidate_code: "A-101",
      question_type: "short_answer",
      max_score: 10,
      suggested_score: 8,
      student_answer_raw: "JVM 将运行时内存划分为堆、虚拟机栈与方法区。",
      knowledge_tags: ["JVM"],
    },
    [
      { stage: "primary", model_label: "Qwen", score: 8, summary: "回答覆盖了主要分区。", process: ["指出堆与栈的区别"], risk_flags: [] },
      { stage: "review", model_label: "DeepSeek", score: 7, summary: "方法区描述略简。", process: [], risk_flags: [] },
    ],
  ),
  "task-q1-b": candidateDetail(
    {
      task_id: "task-q1-b",
      candidate_name: "李四",
      candidate_code: "B-208",
      question_type: "short_answer",
      max_score: 10,
      suggested_score: 5,
      student_answer_raw: "只提到了堆和栈。",
      knowledge_tags: ["JVM"],
    },
    [{ stage: "primary", model_label: "Qwen", score: 5, summary: "遗漏方法区。", process: [], risk_flags: [] }],
  ),
  "task-q2-a": candidateDetail(
    {
      task_id: "task-q2-a",
      candidate_name: "张三",
      candidate_code: "A-101",
      question_type: "code",
      max_score: 15,
      suggested_score: 12,
      student_answer_raw: "class Singleton { private static volatile Singleton i; }",
      knowledge_tags: ["并发编程"],
    },
    [{ stage: "primary", model_label: "Qwen", score: 12, summary: "使用了双重检查锁。", process: [], risk_flags: [] }],
  ),
  "task-q2-b": candidateDetail(
    {
      task_id: "task-q2-b",
      candidate_name: "李四",
      candidate_code: "B-208",
      question_type: "code",
      max_score: 15,
      suggested_score: 9,
      student_answer_raw: "饿汉式单例。",
      knowledge_tags: ["并发编程"],
    },
    [{ stage: "primary", model_label: "Qwen", score: 9, summary: "未处理并发初始化。", process: [], risk_flags: [] }],
  ),
};

/**
 * Returns an `apiRequest`-compatible implementation that routes grading paths to
 * the fixtures above. Responses are cloned so the page's state updates can never
 * mutate the shared fixtures between tests.
 */
export function createGradingApiHandler() {
  return async (path: string, init?: RequestInit): Promise<unknown> => {
    const method = init?.method ?? "GET";

    if (path === "/grading/inbox") {
      return structuredClone(inboxFixture);
    }

    const questionMatch = path.match(/^\/grading\/inbox\/questions\/[^/]+\/([^/]+)$/);
    if (questionMatch) {
      const detail = questionDetailFixtures[questionMatch[1]];
      if (detail) return structuredClone(detail);
    }

    const taskMatch = path.match(/^\/grading\/inbox\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const detail = candidateDetailFixtures[taskMatch[1]];
      if (detail) return structuredClone(detail);
    }

    if (method === "POST" && /^\/grading\/tasks\/[^/]+\/viewed$/.test(path)) {
      return { viewed: true };
    }

    throw new Error(`Unhandled grading request: ${method} ${path}`);
  };
}
