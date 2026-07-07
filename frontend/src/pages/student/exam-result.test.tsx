import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";

import { ExamResultPage } from "./exam-result";

const { getMock, postMock, requestUseMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  requestUseMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: {
        request: {
          use: requestUseMock,
        },
      },
    }),
  },
}));

vi.mock("@/components/ui/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) => (
    <div data-testid="code-block" data-language={language}>
      {code}
    </div>
  ),
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

describe("ExamResultPage", () => {
  const renderResultPage = (initialPath: string) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/my-exams/:id/result" element={<ExamResultPage />} />
        <Route path="/my-exams/:id/take" element={<LocationDisplay />} />
      </Routes>
    </MemoryRouter>
  );

  it("shows question navigation and uses feedback wording instead of appeal status", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-1",
        title: "数据库阶段考试",
        submitted_at: "2026-04-10T08:30:00.000Z",
        total_score: 100,
        score: 88,
        can_view: true,
        can_retake: false,
        blocked_reason: null,
        questions: [
          {
            question_id: "q-1",
            order: 0,
            type: "short_answer",
            title: "什么是索引覆盖？",
            content: { text: "<p>请说明什么是索引覆盖，并给出一个简短例子。</p>" },
            options: null,
            total_score: 20,
            score_awarded: 16,
            is_correct: false,
            answer_content: { html: "<p>回答一</p>" },
            standard_answer: { points: ["减少回表", "覆盖查询列"] },
            analysis: "需要结合回表成本说明。",
            feedback: {
              dimensions: [
                { name: "要点覆盖", score: 10, max_score: 12, comment: "覆盖了核心概念。" },
              ],
              deductions: ["缺少回表代价说明"],
              suggestions: ["补充查询路径解释"],
            },
            appeal_status: null,
            appeal_reason: null,
            appeal_reply: null,
          },
          {
            question_id: "q-2",
            order: 1,
            type: "code",
            title: "实现一个 LRU Cache",
            content: { text: "<p>请实现一个支持 get / put 的 LRU Cache。</p>" },
            options: null,
            total_score: 30,
            score_awarded: 24,
            is_correct: false,
            answer_content: { language: "cpp", code: "int main() { return 0; }" },
            standard_answer: { points: ["哈希表", "双向链表"] },
            analysis: "注意淘汰与更新逻辑。",
            feedback: {
              dimensions: [
                { name: "结构设计", score: 12, max_score: 15, comment: "核心结构基本正确。" },
              ],
              deductions: [],
              suggestions: ["补充淘汰边界处理"],
            },
            appeal_status: "pending",
            appeal_reason: "我的淘汰逻辑已经覆盖边界情况。",
            appeal_reply: "已收到，稍后复核。",
          },
        ],
      },
    });

    render(renderResultPage("/my-exams/exam-1/result"));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/student/exams/exam-1/result");
    });

    expect(screen.getByRole("tab", { name: "题目导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按题型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按序号" })).toBeInTheDocument();
    expect(screen.getAllByText("简答题").length).toBeGreaterThan(0);
    expect(screen.getAllByText("编程题").length).toBeGreaterThan(0);
    expect(screen.getAllByText("答错").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("请说明什么是索引覆盖，并给出一个简短例子。")).toBeInTheDocument();
    expect(screen.queryByText("实现一个 LRU Cache")).not.toBeInTheDocument();
    expect(screen.queryByText("申诉状态：")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交反馈" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "按序号" }));
    expect(screen.getByRole("button", { name: /跳转到第 1 题/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跳转到第 2 题/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /跳转到第 2 题/ }));

    expect(screen.getByText("请实现一个支持 get / put 的 LRU Cache。")).toBeInTheDocument();
    const codeBlocks = screen.getAllByTestId("code-block");
    expect(codeBlocks.length).toBeGreaterThan(0);
    expect(codeBlocks[0]).toHaveAttribute("data-language", "cpp");
    expect(screen.getByText("int main() { return 0; }")).toBeInTheDocument();
    expect(screen.getByText("反馈内容：我的淘汰逻辑已经覆盖边界情况。")).toBeInTheDocument();
    expect(screen.getByText("教师回复：已收到，稍后复核。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已提交反馈" })).toBeDisabled();
  });

  it("supports view-all mode with collapsible detail sections", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-2",
        title: "算法综合考试",
        submitted_at: "2026-04-10T10:00:00.000Z",
        total_score: 100,
        score: 92,
        can_view: true,
        can_retake: false,
        blocked_reason: null,
        questions: [
          {
            question_id: "q-a",
            order: 0,
            type: "choice",
            title: "二叉树的层序遍历使用什么结构？",
            content: { text: "<p>二叉树的层序遍历通常依赖哪一种数据结构？</p>" },
            options: { A: "栈", B: "队列", C: "哈希表", D: "并查集" },
            total_score: 10,
            score_awarded: 10,
            is_correct: true,
            answer_content: { value: "queue" },
            standard_answer: { value: "queue" },
            analysis: "使用队列按层推进。",
            feedback: {
              dimensions: [{ name: "答案正确性", score: 10, max_score: 10, comment: "回答正确。" }],
              deductions: [],
              suggestions: [],
            },
            appeal_status: null,
            appeal_reason: null,
            appeal_reply: null,
          },
          {
            question_id: "q-b",
            order: 1,
            type: "short_answer",
            title: "请解释快速排序的分治思想",
            content: { text: "<p>请解释快速排序的分治思想，并说明递归何时结束。</p>" },
            options: null,
            total_score: 20,
            score_awarded: 14,
            is_correct: false,
            answer_content: { html: "<p>先选枢轴，再划分。</p>" },
            standard_answer: { points: ["选取枢轴", "左右递归划分"] },
            analysis: "还可以补充分区后的递归终止条件。",
            feedback: {
              dimensions: [{ name: "要点完整度", score: 14, max_score: 20, comment: "主干正确，但细节不足。" }],
              deductions: ["缺少递归终止条件"],
              suggestions: ["补充边界条件说明"],
            },
            appeal_status: null,
            appeal_reason: "我在答案最后提到了边界情况。",
            appeal_reply: "教师会结合原答案复核。",
          },
        ],
      },
    });

    render(renderResultPage("/my-exams/exam-2/result"));

    expect(await screen.findByRole("tab", { name: "全部查看" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "全部查看" }));

    expect(screen.getByText("二叉树的层序遍历通常依赖哪一种数据结构？")).toBeInTheDocument();
    expect(screen.getByText("请解释快速排序的分治思想，并说明递归何时结束。")).toBeInTheDocument();
    expect(screen.getByText("队列")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部展开" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开题目解析和反馈" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开评分详情、题目解析和反馈" })).toBeInTheDocument();
    expect(screen.queryByText("答案正确性")).not.toBeInTheDocument();
    expect(screen.queryByText("教师回复：教师会结合原答案复核。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开题目解析和反馈" }));
    expect(screen.queryByText("答案正确性")).not.toBeInTheDocument();
    expect(screen.getByText("题目解析")).toBeInTheDocument();
    expect(screen.getByText("使用队列按层推进。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起详细信息" }));
    expect(screen.queryByText("题目解析：使用队列按层推进。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getByRole("button", { name: "全部收起" })).toBeInTheDocument();
    expect(screen.queryByText("答案正确性")).not.toBeInTheDocument();
    expect(screen.getByText("要点完整度")).toBeInTheDocument();
    expect(screen.getByText("教师回复：教师会结合原答案复核。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部收起" }));
    expect(screen.queryByText("答案正确性")).not.toBeInTheDocument();
    expect(screen.queryByText("教师回复：教师会结合原答案复核。")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "展开评分详情、题目解析和反馈" })[1]);
    expect(screen.getByText("要点完整度")).toBeInTheDocument();
    expect(screen.getByText("还可以补充分区后的递归终止条件。")).toBeInTheDocument();
    expect(screen.getByText("反馈内容：我在答案最后提到了边界情况。")).toBeInTheDocument();
    expect(screen.getByText("教师回复：教师会结合原答案复核。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "收起详细信息" }).length).toBeGreaterThan(0);
  });

  it("renders sql short-answer content as code blocks in the result page", async () => {
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-sql",
        title: "SQL 考试",
        submitted_at: "2026-04-10T10:00:00.000Z",
        total_score: 20,
        score: 18,
        can_view: true,
        can_retake: false,
        blocked_reason: null,
        questions: [
          {
            question_id: "q-sql",
            order: 0,
            type: "short_answer",
            title: "请编写 SQL 查询语句",
            content: { text: "<p>请使用 SQL 查询所有分数大于 90 的学生。</p>" },
            options: null,
            total_score: 20,
            score_awarded: 18,
            is_correct: false,
            answer_content: { language: "sql", code: "SELECT * FROM scores WHERE score > 90;" },
            standard_answer: { correct: "SELECT name FROM scores WHERE score > 90;" },
            analysis: null,
            feedback: { dimensions: [], deductions: [], suggestions: [] },
            appeal_status: null,
            appeal_reason: null,
            appeal_reply: null,
          },
        ],
      },
    });

    render(renderResultPage("/my-exams/exam-sql/result"));

    const codeBlocks = await screen.findAllByTestId("code-block");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveAttribute("data-language", "sql");
    expect(codeBlocks[1]).toHaveAttribute("data-language", "sql");
    expect(screen.getByText("SELECT * FROM scores WHERE score > 90;")).toBeInTheDocument();
    expect(screen.getByText("SELECT name FROM scores WHERE score > 90;")).toBeInTheDocument();
  });

  it("shows model evaluation output for fill-in questions when available", async () => {
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-fill-in",
        title: "Pandas 考试",
        submitted_at: "2026-04-10T10:00:00.000Z",
        total_score: 2,
        score: 1.33,
        can_view: true,
        can_retake: false,
        blocked_reason: null,
        questions: [
          {
            question_id: "q-fill",
            order: 32,
            type: "fill_in",
            title: "Pandas 聚合函数",
            content: { text: "<p>Pandas中聚合数据的三个函数分别是____、____、____。</p>" },
            options: null,
            total_score: 2,
            score_awarded: 1.33,
            is_correct: false,
            answer_content: { blanks: ["agg()", "apply()", "transform()"] },
            standard_answer: { correct: ["groupby", "agg", "transform"] },
            analysis: null,
            feedback: {
              dimensions: [{ name: "填空准确率", score: 1.33, max_score: 2, comment: "共命中 2/3 个空。" }],
              strengths: ["命中 2 个空。"],
              deductions: ["第 1 空应为 groupby"],
              suggestions: ["复查拼写、术语与顺序。"],
              model_evaluation: {
                model: "deepseek-v4-flash",
                matches: [
                  { is_correct: false, reason: "apply 不是 groupby。" },
                  { is_correct: true, reason: "agg() 与 agg 等价。" },
                  { is_correct: true, reason: "transform() 与 transform 等价。" },
                ],
              },
            },
            appeal_status: null,
            appeal_reason: null,
            appeal_reply: null,
          },
        ],
      },
    });

    render(renderResultPage("/my-exams/exam-fill-in/result"));

    expect((await screen.findAllByText("1.33 / 2")).length).toBeGreaterThan(0);
    expect(screen.getByText("模型评估输出")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("agg() 与 agg 等价。")).toBeInTheDocument();
    expect(screen.getByText("transform() 与 transform 等价。")).toBeInTheDocument();
  });

  it("renders question analysis as rich html so embedded images remain viewable", async () => {
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-analysis-html",
        title: "图文解析考试",
        submitted_at: "2026-04-10T10:00:00.000Z",
        total_score: 10,
        score: 10,
        can_view: true,
        can_retake: false,
        blocked_reason: null,
        questions: [
          {
            question_id: "q-analysis-html",
            order: 0,
            type: "choice",
            title: "识别流程图节点",
            content: { text: "<p>请选择正确节点。</p>" },
            options: { A: "开始", B: "结束" },
            total_score: 10,
            score_awarded: 10,
            is_correct: true,
            answer_content: { value: "A" },
            standard_answer: { value: "A" },
            analysis:
              '<p>先看箭头方向。</p><p><img src="https://example.com/analysis.png" alt="流程图解析" /></p>',
            feedback: { dimensions: [], deductions: [], suggestions: [] },
            appeal_status: null,
            appeal_reason: null,
            appeal_reply: null,
          },
        ],
      },
    });

    render(renderResultPage("/my-exams/exam-analysis-html/result"));


    expect(await screen.findByText("先看箭头方向。")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "流程图解析" })).toBeInTheDocument();
  });

  it("shows a retake entry on the result page when retake is allowed", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: {
        exam_id: "exam-retake",
        title: "可重考练习",
        submitted_at: "2026-04-10T10:00:00.000Z",
        total_score: 100,
        score: 86,
        objective_score: 86,
        subjective_score: null,
        grading_status: "reviewed",
        can_view: false,
        can_retake: true,
        blocked_reason: "教师暂未开放查看结果权限",
        questions: [],
      },
    });

    render(renderResultPage("/my-exams/exam-retake/result"));

    expect(await screen.findByText("教师暂未开放查看结果权限")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重考" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/my-exams/exam-retake/take?retake=1");
  });

  it("renders a compact mobile result card with retake access", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const user = userEvent.setup();
      getMock.mockResolvedValue({
        data: {
          exam_id: "exam-mobile-retake",
          title: "手机端可重考练习",
          submitted_at: "2026-04-10T10:00:00.000Z",
          total_score: 10,
          score: 8,
          objective_score: 8,
          subjective_score: null,
          grading_status: "reviewed",
          can_view: true,
          can_retake: true,
          blocked_reason: null,
          questions: [
            {
              question_id: "q-mobile",
              order: 0,
              type: "choice",
              title: "移动端结果题",
              content: { text: "<p>移动端结果页题干。</p>" },
              options: { A: "选项 A", B: "选项 B" },
              total_score: 10,
              score_awarded: 8,
              is_correct: false,
              answer_content: { selected: ["A"] },
              standard_answer: { correct: "B" },
              analysis: "移动端解析内容。",
              feedback: { dimensions: [], deductions: [], suggestions: [] },
              appeal_status: null,
              appeal_reason: null,
              appeal_reply: null,
            },
          ],
        },
      });

      render(renderResultPage("/my-exams/exam-mobile-retake/result"));

      expect(await screen.findByText("手机端可重考练习")).toBeInTheDocument();
      expect(screen.getByText("移动端结果页题干。")).toBeInTheDocument();
      expect(screen.getByText("8")).toBeInTheDocument();
      expect(screen.getByText("/10")).toBeInTheDocument();
      expect(screen.getByText("移动端解析内容。")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "重考" }));

      expect(screen.getByTestId("location")).toHaveTextContent("/my-exams/exam-mobile-retake/take?retake=1");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
