import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor, within } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionImportDraft } from "./import-types";
import { QuestionImportPage } from "./import";
import * as importUtils from "./import-utils";
import {
  applySourceDraftEdits,
  approveAllPendingDrafts,
  buildStandardImportTemplate,
  buildImportableQuestions,
  buildImportSummary,
  canApproveAllDrafts,
  countFastImportEligibleDrafts,
  extractHtmlTables,
  extractQuestionImportPayload,
  getBlockingImportIssues,
  getDraftPreviewText,
  getNextDraftIdAfterRemoval,
  hasBlockingImportIssues,
  htmlToImportText,
  importTextToHtml,
  parseJsonQuestions,
  structuredJsonText,
} from "./import-utils";

const navigateMock = vi.fn();
const useListMock = vi.fn(() => ({ query: { data: { data: [] } } }));
const fetchMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@refinedev/core", async () => {
  const actual = await vi.importActual<typeof import("@refinedev/core")>("@refinedev/core");
  return {
    ...actual,
    useGetIdentity: () => ({ data: { primary_org: { role_name: "teacher" } } }),
    useList: () => useListMock(),
  };
});

// 编辑弹窗内嵌的题库编辑表单使用 RichTextEditor（tiptap），在 jsdom 下以简单 textarea 替身。
vi.mock("@/components/ui/rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder ?? "富文本编辑器"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  htmlToPlainText: (value: string) => value.replace(/<[^>]+>/g, "").trim(),
}));

function renderImportPage() {
  return render(
    <MemoryRouter>
      <QuestionImportPage />
    </MemoryRouter>,
  );
}

const baseDraft: QuestionImportDraft = {
  draft_id: "draft-1",
  raw_text: "1. 单选题 示例",
  title: "示例题",
  type: "choice",
  content_text: "示例题",
  options: { A: "选项 A", B: "选项 B" },
  answer_text: "A",
  analysis: "",
  difficulty: 2,
  segment_source: "rule",
  type_confidence: "high",
  boundary_confidence: "high",
  issues: [],
  review_status: "pending",
  review_required: true,
};

function mockJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  navigateMock.mockReset();
  useListMock.mockClear();
  fetchMock.mockReset();
  localStorage.clear();
  window.history.pushState({}, "", "/questions/import");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("question import helpers", () => {
  it("parses standard JSON question fields without losing structured answers or scores", () => {
    const source = JSON.stringify({
      questions: [
        {
          type: "multiple_choice",
          title: "选择正确答案",
          content: { text: "哪些选项正确？", html: "<p>哪些选项正确？</p>" },
          options: { A: { text: "甲" }, B: "乙" },
          answer: { correct: ["A", "B"] },
          analysis: "两项都正确。",
          difficulty: "较难",
          score: 7,
        },
        { type: "true_false", content: "命题为真。", answer: { correct: false } },
      ],
    });

    const { drafts } = parseJsonQuestions(source);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      content_text: "哪些选项正确？",
      content_html: "<p>哪些选项正确？</p>",
      options: { A: "甲", B: "乙" },
      answer_text: "A、B",
      difficulty: 4,
      score: 7,
    });
    expect(drafts[1].answer_text).toBe("false");

    const questions = buildImportableQuestions(
      drafts.map((draft) => ({ ...draft, review_status: "approved" })),
      null,
    );
    expect(questions[0].answer.correct).toEqual(["A", "B"]);
    expect(questions[0].score).toBe(7);
    expect(questions[1].answer.correct).toBe(false);
  });

  it("does not silently drop malformed JSON items and recognizes fenced JSON in Markdown", () => {
    const valid = JSON.stringify({ type: "choice", content: "题干", options: { A: "甲", B: "乙" }, answer: "A" });
    expect(structuredJsonText(`\`\`\`json\n${valid}\n\`\`\``)).toBe(valid);
    expect(structuredJsonText("[题型] 选择题\n题目内容：题干")).toBeNull();
    expect(() => parseJsonQuestions(JSON.stringify({ questions: [JSON.parse(valid), null] })))
      .toThrow("第 2 道题不是 JSON 对象");
  });

  it("only builds bulk import payloads from human-approved drafts", () => {
    const questions = buildImportableQuestions(
      [
        { ...baseDraft, draft_id: "approved", review_status: "approved", review_required: false },
        { ...baseDraft, draft_id: "pending", review_status: "pending", review_required: true },
        { ...baseDraft, draft_id: "skipped", review_status: "skipped", review_required: false },
      ],
      "bank-1",
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].question_bank_id).toBe("bank-1");
    expect(questions[0].title).toBe("示例题");
  });

  it("allows approved drafts that only miss answers but excludes blocking abnormal drafts", () => {
    const questions = buildImportableQuestions(
      [
        {
          ...baseDraft,
          draft_id: "missing-answer",
          answer_text: null,
          issues: ["未识别到答案"],
          review_status: "approved",
          review_required: false,
        },
        {
          ...baseDraft,
          draft_id: "abnormal",
          issues: ["选择题选项不完整"],
          review_status: "approved",
          review_required: false,
        },
      ],
      "bank-1",
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].title).toBe("示例题");
  });

  it("distinguishes missing answers from blocking abnormal issues", () => {
    const missingAnswerDraft = { ...baseDraft, issues: ["未识别到答案"] };
    const abnormalDraft = { ...baseDraft, issues: ["未识别到答案", "题型不确定"] };

    expect(hasBlockingImportIssues(missingAnswerDraft)).toBe(false);
    expect(getBlockingImportIssues(missingAnswerDraft)).toEqual([]);
    expect(hasBlockingImportIssues(abnormalDraft)).toBe(true);
    expect(getBlockingImportIssues(abnormalDraft)).toEqual(["题型不确定"]);
  });

  it("allows bulk approval when only pending and missing-answer drafts remain", () => {
    expect(
      canApproveAllDrafts([
        { ...baseDraft, draft_id: "pending-1", review_status: "pending" },
        { ...baseDraft, draft_id: "missing-answer", answer_text: null, issues: ["未识别到答案"], review_status: "pending" },
        { ...baseDraft, draft_id: "approved", review_status: "approved", review_required: false },
      ]),
    ).toBe(true);
  });

  it("allows bulk approval when at least one pending draft is eligible even if another draft is abnormal", () => {
    expect(
      canApproveAllDrafts([
        { ...baseDraft, draft_id: "pending-1", review_status: "pending" },
        { ...baseDraft, draft_id: "abnormal", issues: ["题型不确定"], review_status: "pending" },
      ]),
    ).toBe(true);
  });

  it("approves all pending drafts and generates titles without touching skipped items", () => {
    const result = approveAllPendingDrafts([
      { ...baseDraft, draft_id: "pending-1", title: "", content_text: "第一题题干", review_status: "pending" },
      { ...baseDraft, draft_id: "pending-2", title: "", content_text: "第二题题干", review_status: "pending", answer_text: null, issues: ["未识别到答案"] },
      { ...baseDraft, draft_id: "skipped", title: "跳过题", review_status: "skipped", review_required: false },
    ]);

    expect(result[0]).toMatchObject({ review_status: "approved", review_required: false, title: "第一题题干" });
    expect(result[1]).toMatchObject({ review_status: "approved", review_required: false, title: "第二题题干" });
    expect(result[2]).toMatchObject({ review_status: "skipped", review_required: false, title: "跳过题" });
  });

  it("counts drafts eligible for fast import without requiring manual approval", () => {
    const drafts: QuestionImportDraft[] = [
      { ...baseDraft, draft_id: "pending-ok", review_status: "pending" },
      { ...baseDraft, draft_id: "approved", review_status: "approved", review_required: false },
      { ...baseDraft, draft_id: "missing-answer", review_status: "pending", answer_text: null, issues: ["未识别到答案"] },
      { ...baseDraft, draft_id: "abnormal", review_status: "pending", issues: ["题型不确定"] },
    ];

    expect(countFastImportEligibleDrafts(drafts)).toBe(3);
  });

  it("counts pending review, approved, skipped, and issue states", () => {
    const summary = buildImportSummary([
      { ...baseDraft, review_status: "approved", review_required: false },
      { ...baseDraft, draft_id: "pending", issues: ["未识别到答案"] },
      { ...baseDraft, draft_id: "skipped", review_status: "skipped", review_required: false },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.pending_review).toBe(1);
    expect(summary.approved).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.issue_count).toBe(1);
  });

  it("keeps imported image tags in generated question html", () => {
    const html = importTextToHtml("观察下图并回答。\n<img src=\"/api/uploads/files/chart.png\" alt=\"图表\" />");

    expect(html).toContain("<p>观察下图并回答。</p>");
    expect(html).toContain("<img src=\"/api/uploads/files/chart.png\" alt=\"图表\" />");
  });

  it("renders markdown table blocks as real <table> with thead and tbody", () => {
    const content = [
      "设某路由器建立了如下转发表",
      "| 目的网络 | 子网掩码 | 下一跳 |",
      "| --- | --- | --- |",
      "| 128.96.39.0 | 255.255.255.128 | 接口 m0 |",
      "| 192.4.153.0 | 255.255.255.192 | R3 |",
      "试分别计算其下一跳。",
    ].join("\n");
    const html = importTextToHtml(content);

    expect(html).toContain("<p>设某路由器建立了如下转发表</p>");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead><tr><th>目的网络</th><th>子网掩码</th><th>下一跳</th></tr></thead>");
    expect(html).toContain("<td>128.96.39.0</td><td>255.255.255.128</td><td>接口 m0</td>");
    expect(html).toContain("<td>192.4.153.0</td><td>255.255.255.192</td><td>R3</td>");
    expect(html).not.toContain("---");
    expect(html).toContain("<p>试分别计算其下一跳。</p>");
  });

  it("renders markdown tables without a header separator as a body-only table", () => {
    const html = importTextToHtml("| 列1 | 列2 |\n| 值1 | 值2 |");

    expect(html).toContain("<tbody>");
    expect(html).not.toContain("<thead>");
    expect(html).toContain("<td>列1</td><td>列2</td>");
  });

  it("prefers edited content_html/answer_html (with images) when building importable questions", () => {
    const drafts: QuestionImportDraft[] = [
      {
        ...baseDraft,
        draft_id: "draft-rich",
        type: "short_answer",
        content_text: "简述 TCP 三次握手",
        content_html: "<p>简述 TCP 三次握手</p><img src=\"/api/uploads/files/q.png\" alt=\"图\" />",
        options: null,
        answer_text: "第一次握手\n第二次握手",
        answer_html: "<p>第一次握手</p><img src=\"/api/uploads/files/a.png\" alt=\"答案图\" />",
        review_status: "approved",
        review_required: false,
      },
    ];

    const [question] = buildImportableQuestions(drafts, null);

    // 题干优先使用编辑后的 HTML（含图片），而非由纯文本再生成。
    expect(question.content.html).toContain("/api/uploads/files/q.png");
    // 答案保留 points/text 供评分，并携带 html（含图片）。
    expect(question.answer).toMatchObject({
      points: ["第一次握手", "第二次握手"],
      html: expect.stringContaining("/api/uploads/files/a.png"),
    });
  });

  it("falls back to text-derived content and plain answer when no edited html is present", () => {
    const drafts: QuestionImportDraft[] = [
      {
        ...baseDraft,
        draft_id: "draft-plain",
        type: "short_answer",
        content_text: "纯文本题干",
        options: null,
        answer_text: "要点一\n要点二",
        review_status: "approved",
        review_required: false,
      },
    ];

    const [question] = buildImportableQuestions(drafts, null);

    expect(question.content.html).toContain("纯文本题干");
    expect(question.answer).toEqual({ points: ["要点一", "要点二"] });
    expect(question.answer).not.toHaveProperty("html");
  });

  it("selects the next draft after removing the current selected draft", () => {
    const drafts = [
      { ...baseDraft, draft_id: "draft-1" },
      { ...baseDraft, draft_id: "draft-2" },
      { ...baseDraft, draft_id: "draft-3" },
    ];

    expect(getNextDraftIdAfterRemoval(drafts, "draft-2", "draft-2")).toBe("draft-3");
    expect(getNextDraftIdAfterRemoval(drafts, "draft-3", "draft-3")).toBe("draft-2");
    expect(getNextDraftIdAfterRemoval(drafts, "draft-2", "draft-1")).toBe("draft-1");
  });

  it("applies source edits to raw and content fields and reopens review for changed drafts", () => {
    const result = applySourceDraftEdits(
      [
        { ...baseDraft, draft_id: "draft-1", raw_text: "旧原文", content_text: "旧题干", review_status: "approved", review_required: false },
        { ...baseDraft, draft_id: "draft-2", raw_text: "保持不变", content_text: "保持不变", review_status: "approved", review_required: false },
      ],
      {
        "draft-1": "新原文",
        "draft-2": "保持不变",
      },
    );

    expect(result[0]).toMatchObject({
      raw_text: "新原文",
      content_text: "新原文",
      review_status: "pending",
      review_required: true,
    });
    expect(result[1]).toMatchObject({
      raw_text: "保持不变",
      content_text: "保持不变",
      review_status: "approved",
      review_required: false,
    });
  });

  it("uses the latest question content as the sidebar preview text", () => {
    expect(getDraftPreviewText({ ...baseDraft, title: "旧标题", content_text: "老师刚修改的新题干" })).toBe(
      "老师刚修改的新题干",
    );
  });

  it("builds a standard markdown template with difficulty mapping guidance", () => {
    const template = buildStandardImportTemplate();

    expect(template).toContain("容易 = 1");
    expect(template).toContain("较易 = 2");
    expect(template).toContain("中等 = 3");
    expect(template).toContain("较难 = 4");
    expect(template).toContain("[题型] 选择题");
    expect(template).toContain("[答案] A");
    expect(template).toContain("[解析] 北京是中国首都。");
    expect(template).toContain("[难度] 中等");
  });

  it("extracts markdown image metadata for ai-full analysis payloads", async () => {
    const file = new File(["题干\n![图1](https://example.com/a.png)"], "questions.md", { type: "text/markdown" });

    const payload = await extractQuestionImportPayload(file);

    expect(payload.sourceFormat).toBe("md");
    expect(payload.rawText).toContain('<img src="https://example.com/a.png" alt="图1" data-image-id="image-1" />');
    expect(payload.images).toEqual([
      {
        image_id: "image-1",
        url: "https://example.com/a.png",
        order: 1,
        alt: "图1",
      },
    ]);
  });

  it("preserves ordered list items as [OL] markers for backend parsing", () => {
    const html = `
      <p>1. 请提交今日课堂练习：</p>
      <ol>
        <li>提交 PDM 截图；</li>
        <li>提交 MySQL 脚本截图；</li>
      </ol>
      <p>要求写出截图标题，截图清晰。</p>
      <p>[答案]</p>
      <p>[难度] 简单</p>
      <p>[预计时间]</p>
      <p>2. 请提交今日课堂练习：</p>
      <ol>
        <li>提交功能模块图；</li>
        <li>提交概念数据模型 E-R 图；</li>
      </ol>
      <p>[答案]</p>
      <p>[难度] 简单</p>
    `;

    const text = htmlToImportText(html);

    expect(text).toContain("1. 请提交今日课堂练习：");
    expect(text).toContain("[OL] 提交 PDM 截图；");
    expect(text).toContain("[OL] 提交 MySQL 脚本截图；");
    expect(text).toContain("\n\n2. 请提交今日课堂练习：");
    expect(text).not.toContain("提交 PDM 截图；提交 MySQL 脚本截图；");
  });

  it("preserves unordered list items as [UL] markers instead of flattening them", () => {
    const html = `
      <p>题目要求：</p>
      <ul>
        <li>先完成草图；</li>
        <li>再提交最终版本；</li>
      </ul>
      <p>[答案]</p>
    `;

    const text = htmlToImportText(html);

    expect(text).toContain("题目要求：");
    expect(text).toContain("[UL] 先完成草图；");
    expect(text).toContain("[UL] 再提交最终版本；");
    expect(text).not.toContain("先完成草图；再提交最终版本；");
  });

  it("emits a [TABLE:N] marker inline where a table appears so AI can place it next to its question", () => {
    const html = `
      <p>3. 设某路由器建立了如下转发表</p>
      <table>
        <tr><td>目的网络</td><td>子网掩码</td><td>下一跳</td></tr>
        <tr><td>128.96.39.0</td><td>255.255.255.128</td><td>接口 m0</td></tr>
      </table>
      <p>现共收到 5 个分组，试分别计算其下一跳。</p>
    `;

    const text = htmlToImportText(html);

    expect(text).toContain("3. 设某路由器建立了如下转发表");
    expect(text).toContain("[TABLE:1]");
    expect(text.indexOf("3. 设某路由器")).toBeLessThan(text.indexOf("[TABLE:1]"));
    expect(text.indexOf("[TABLE:1]")).toBeLessThan(text.indexOf("现共收到 5 个分组"));
    expect(text).not.toContain("目的网络");
    expect(text).not.toContain("128.96.39.0");
  });

  it("extracts docx html tables as structured rows", () => {
    const html = `
      <table>
        <tr><td>题号</td><td>一</td><td>二</td></tr>
        <tr><td>得分</td><td></td><td>10</td></tr>
      </table>
    `;

    expect(extractHtmlTables(html)).toEqual([
      {
        order: 1,
        rows: [
          ["题号", "一", "二"],
          ["得分", "", "10"],
        ],
      },
    ]);
  });
});

describe("QuestionImportPage", () => {
  it("reviews a standard JSON file directly without requesting AI recognition", async () => {
    renderImportPage();
    const source = JSON.stringify({
      questions: [{ type: "choice", content: "首都是哪里？", options: { A: "北京", B: "上海" }, answer: { correct: "A" } }],
    });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [new File([source], "questions.json", { type: "application/json" })] },
    });

    expect(await screen.findByText("JSON 规则解析")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 1 道题目" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the upload screen focused on file selection", () => {
    renderImportPage();

    expect(screen.getByRole("button", { name: "选择本地文件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "快速识别" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 一键分析整个文件" })).not.toBeInTheDocument();
  });

  it("shows the optimized review workspace after document recognition", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 1,
          high_confidence: 0,
          medium_confidence: 1,
          low_confidence: 0,
          issue_count: 0,
          pending_review: 1,
          approved: 0,
          skipped: 0,
        },
        drafts: [{ ...baseDraft }],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 1 道题目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部题目 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "单选题 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "多选题 1" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索题目内容、答案、解析或选项...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开查看答案" })).not.toBeInTheDocument();
    // 与题目列表一致：正确答案内联标在选项上，收起态不再单独渲染「答案」区。
    expect(screen.queryByText("答案")).not.toBeInTheDocument();
    const option = (text: string) =>
      screen.getByText((_, node) => node?.textContent === text);
    expect(option("A. 选项 A").className).toContain("text-primary");
    expect(option("B. 选项 B").className).not.toContain("text-primary");
    // 点击卡片可展开与收缩。
    const details = screen.getByTestId("question-preview-details");
    expect(details).toHaveClass("grid-rows-[0fr]");
    fireEvent.click(option("A. 选项 A"));
    await waitFor(() =>
      expect(screen.getByTestId("question-preview-details")).toHaveClass(
        "grid-rows-[1fr]",
      ),
    );
    fireEvent.click(option("A. 选项 A"));
    await waitFor(() =>
      expect(screen.getByTestId("question-preview-details")).toHaveClass(
        "grid-rows-[0fr]",
      ),
    );
  });

  it("splits choice drafts into 单选题 and 多选题 in the review sidebar", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 2,
          high_confidence: 2,
          medium_confidence: 0,
          low_confidence: 0,
          issue_count: 0,
          pending_review: 2,
          approved: 0,
          skipped: 0,
        },
        drafts: [
          { ...baseDraft, draft_id: "single", content_text: "单选题题干", answer_text: "A" },
          {
            ...baseDraft,
            draft_id: "multi",
            content_text: "多选题题干",
            answer_text: "BD",
            options: { A: "甲", B: "乙", C: "丙", D: "丁" },
          },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();
    const singleFilter = screen.getByRole("button", { name: "单选题 1" });
    const multiFilter = screen.getByRole("button", { name: "多选题 1" });
    expect(singleFilter).toBeInTheDocument();
    expect(multiFilter).toBeInTheDocument();
    // 侧边筛选 + 题目卡片题型标签都会显示「单选题 / 多选题」。
    expect(screen.getAllByText("单选题").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("多选题").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(multiFilter);
    expect(await screen.findByText("多选题题干")).toBeInTheDocument();
    expect(screen.queryByText("单选题题干")).not.toBeInTheDocument();

    fireEvent.click(singleFilter);
    expect(await screen.findByText("单选题题干")).toBeInTheDocument();
    expect(screen.queryByText("多选题题干")).not.toBeInTheDocument();
  });

  it("rejects files larger than 40MB before recognition", async () => {
    renderImportPage();

    const file = new File(["docx-body"], "huge.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    Object.defineProperty(file, "size", { value: 41 * 1024 * 1024 });

    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/文件过大/)).toBeInTheDocument();
    expect(screen.getByText(/40 MB 以内的文件/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers enhance scope and only sends missing drafts by default", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "smart",
      summary: {
        total: 2,
        duplicates_removed: 0,
        high_confidence: 1,
        medium_confidence: 1,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 2,
        approved: 0,
        skipped: 0,
      },
      drafts: [
        {
          ...baseDraft,
          draft_id: "complete",
          answer_text: "A",
          suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
        },
        {
          ...baseDraft,
          draft_id: "missing",
          answer_text: null,
          issues: ["未识别到答案"],
          suggested_knowledge_points: [],
        },
      ],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("enhance-drafts-stream")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, { status: 200 });
      }
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    const user = userEvent.setup();
    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "完善答案" }));

    expect(await screen.findByText("完善范围")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "仅补齐缺失" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部题目" })).toBeInTheDocument();
    // 「完善答案」弹窗只显示答案相关的缺失统计
    expect(screen.getByText("缺失答案 1 题")).toBeInTheDocument();

    // 默认「仅补齐缺失」：只把缺答案的草稿发给模型
    fireEvent.click(screen.getByRole("button", { name: "完善答案" }));

    const enhanceCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("enhance-drafts-stream"),
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });
    const missingScopeBody = JSON.parse(String(enhanceCall[1].body));
    expect(missingScopeBody.mode).toBe("answers");
    expect(missingScopeBody.drafts.map((d: { draft_id: string }) => d.draft_id)).toEqual([
      "missing",
    ]);
  });

  it("shows the knowledge points and difficulty recognized from the document", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "visual",
        summary: {
          total: 1,
          high_confidence: 1,
          medium_confidence: 0,
          low_confidence: 0,
          issue_count: 0,
          pending_review: 1,
          approved: 0,
          skipped: 0,
        },
        drafts: [
          {
            ...baseDraft,
            difficulty: 4,
            question_number: 32,
            recognized_knowledge_points: ["人工智能信息技术基础"],
          },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["scan"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();
    expect(screen.getByText("识别知识点：")).toBeInTheDocument();
    expect(screen.getByText("人工智能信息技术基础")).toBeInTheDocument();
    expect(screen.getByText("较难")).toBeInTheDocument();
  });

  it("sends recognized knowledge points to the enhance endpoint", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "visual",
      summary: {
        total: 1,
        duplicates_removed: 0,
        high_confidence: 0,
        medium_confidence: 1,
        low_confidence: 0,
        issue_count: 1,
        pending_review: 1,
        approved: 0,
        skipped: 0,
      },
      drafts: [
        {
          ...baseDraft,
          answer_text: null,
          issues: ["未识别到答案"],
          recognized_knowledge_points: ["人工智能信息技术基础"],
        },
      ],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("enhance-drafts-stream")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, { status: 200 });
      }
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/questions/import",
            state: { courseKpId: "kp-software", courseName: "软件工程" },
          },
        ]}
      >
        <QuestionImportPage />
      </MemoryRouter>,
    );

    const file = new File(["scan"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "完善知识点" }));
    fireEvent.click(await screen.findByRole("button", { name: "完善知识点" }));

    const enhanceCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("enhance-drafts-stream"),
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });
    const body = JSON.parse(String(enhanceCall[1].body));
    expect(body.mode).toBe("knowledge");
    expect(body.drafts[0].recognized_knowledge_points).toEqual(["人工智能信息技术基础"]);
  });

  it("offers a combined enhance item that runs answers and knowledge together", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "smart",
      summary: {
        total: 1,
        duplicates_removed: 0,
        high_confidence: 1,
        medium_confidence: 0,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 1,
        approved: 0,
        skipped: 0,
      },
      drafts: [{ ...baseDraft, answer_text: null, suggested_knowledge_points: [] }],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("enhance-drafts-stream")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, { status: 200 });
      }
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    // 从课程进入：父知识点已预置，可直接同时完善
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/questions/import",
            state: { courseKpId: "kp-software", courseName: "软件工程" },
          },
        ]}
      >
        <QuestionImportPage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "同时完善" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/作为父知识点/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "完善答案与知识点" }));

    const enhanceCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("enhance-drafts-stream"),
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });
    const body = JSON.parse(String(enhanceCall[1].body));
    expect(body.mode).toBe("both");
    expect(body.root_knowledge_point_id).toBe("kp-software");
  });

  it("offers an analysis-only enhance item that keeps answers untouched", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "smart",
      summary: {
        total: 1,
        duplicates_removed: 0,
        high_confidence: 1,
        medium_confidence: 0,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 1,
        approved: 0,
        skipped: 0,
      },
      drafts: [{ ...baseDraft, analysis: "" }],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("enhance-drafts-stream")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, { status: 200 });
      }
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/questions/import"]}>
        <QuestionImportPage />
      </MemoryRouter>,
    );

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "完善题目解析" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/不改动已有答案/)).toBeInTheDocument();
    // 解析模式不需要父知识点，弹窗里不应出现知识点选择器
    expect(within(dialog).queryByText("父知识点")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "完善题目解析" }));

    const enhanceCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("enhance-drafts-stream"),
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });
    const body = JSON.parse(String(enhanceCall[1].body));
    expect(body.mode).toBe("analysis");
    expect(body.root_knowledge_point_id).toBeNull();
  });

  it("opens the knowledge enhance dialog with a parent knowledge point field", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "smart",
      summary: {
        total: 1,
        duplicates_removed: 0,
        high_confidence: 1,
        medium_confidence: 0,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 1,
        approved: 0,
        skipped: 0,
      },
      drafts: [{ ...baseDraft, suggested_knowledge_points: [] }],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    const user = userEvent.setup();
    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "完善知识点" }));

    expect(await screen.findByText("父知识点")).toBeInTheDocument();
    expect(screen.getByText("题目将从所选父知识点下的子知识点中关联。")).toBeInTheDocument();
    // 未选择父知识点前不能提交
    expect(screen.getByRole("button", { name: "完善知识点" })).toBeDisabled();
  });

  it("sends every draft when the enhance scope is set to all questions", async () => {
    const recognitionResponse = mockJsonResponse({
      mode: "smart",
      summary: {
        total: 2,
        duplicates_removed: 0,
        high_confidence: 1,
        medium_confidence: 1,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 2,
        approved: 0,
        skipped: 0,
      },
      drafts: [
        {
          ...baseDraft,
          draft_id: "complete",
          answer_text: "A",
          suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
        },
        { ...baseDraft, draft_id: "missing", answer_text: null },
      ],
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("enhance-drafts-stream")) {
        return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, { status: 200 });
      }
      if (String(url).includes("recognize")) return recognitionResponse;
      return mockJsonResponse([]);
    });

    const user = userEvent.setup();
    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });
    await screen.findByText("核对导入内容");

    await user.click(screen.getByRole("button", { name: /完善答案与知识点/ }));
    await user.click(await screen.findByRole("menuitem", { name: "完善答案" }));
    await screen.findByText("完善范围");
    fireEvent.click(screen.getByRole("button", { name: "全部题目" }));
    expect(screen.getByText("将处理全部 2 题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完善答案" }));

    const enhanceCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("enhance-drafts-stream"),
      );
      expect(call).toBeTruthy();
      return call as [string, RequestInit];
    });
    const allScopeBody = JSON.parse(String(enhanceCall[1].body));
    expect(allScopeBody.drafts.map((d: { draft_id: string }) => d.draft_id)).toEqual([
      "complete",
      "missing",
    ]);
  });

  it("re-recognizes the imported document with AI from the review header", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 1,
            duplicates_removed: 0,
            high_confidence: 0,
            medium_confidence: 1,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 1,
            approved: 0,
            skipped: 0,
            incomplete_choice_count: 0,
            visual_retry_recommended: false,
          },
          drafts: [{ ...baseDraft, content_text: "初始题目" }],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 1,
            duplicates_removed: 0,
            high_confidence: 1,
            medium_confidence: 0,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 1,
            approved: 0,
            skipped: 0,
            incomplete_choice_count: 0,
            visual_retry_recommended: false,
          },
          drafts: [{ ...baseDraft, draft_id: "ai-draft", content_text: "AI重新识别后的题目", difficulty: 3 }],
        }),
      );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "AI重新识别" }));

    expect(await screen.findByText("AI正在重新识别")).toBeInTheDocument();
    await screen.findByText("AI重新识别后的题目");
    expect(screen.getByText("AI重新识别完成")).toBeInTheDocument();
    expect(screen.getByText("已重新识别 1 道题目，列表已更新。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/questions/import/document-recognize",
      expect.objectContaining({
        body: expect.stringContaining('"analysis_mode":"ai_full"'),
      }),
    );
  });

  it("shows a docx quality warning when the backend recommends extra review", async () => {
    vi.spyOn(importUtils, "extractQuestionImportPayload").mockResolvedValue({
      rawText: "1. 单选题 示例",
      sourceFormat: "docx",
      images: [],
      tables: [{ order: 1, rows: [["题号", "一"]] }],
    });

    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 2,
          duplicates_removed: 0,
          high_confidence: 0,
          medium_confidence: 2,
          low_confidence: 0,
          issue_count: 2,
          pending_review: 2,
          approved: 0,
          skipped: 0,
          incomplete_choice_count: 2,
          visual_retry_recommended: true,
        },
        drafts: [
          { ...baseDraft, draft_id: "docx-1", issues: ["选择题选项不完整"] },
          { ...baseDraft, draft_id: "docx-2", issues: ["选择题选项不完整"] },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["docx-body"], "questions.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/当前 Word 文档可能使用了自动编号/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions/import/docx-recognize",
      expect.objectContaining({
        body: expect.any(FormData),
      }),
    );

    fireEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(() => {
      expect(screen.queryByText(/当前 Word 文档可能使用了自动编号/)).not.toBeInTheDocument();
    });
  });

  it("shows a page visual recognition button when the backend flags docx for extra review", async () => {
    vi.spyOn(importUtils, "extractQuestionImportPayload").mockResolvedValue({
      rawText: "1. 单选题 示例",
      sourceFormat: "docx",
      images: [],
      tables: [],
    });

    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 2, duplicates_removed: 0, high_confidence: 0,
          medium_confidence: 2, low_confidence: 0, issue_count: 2,
          pending_review: 2, approved: 0, skipped: 0,
          incomplete_choice_count: 2,
          visual_retry_recommended: true,
        },
        drafts: [
          { ...baseDraft, draft_id: "1", issues: ["选择题选项不完整"] },
          { ...baseDraft, draft_id: "2", issues: ["选择题选项不完整"] },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["docx-body"], "questions.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/当前 Word 文档可能使用了自动编号/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /页面视觉识别/ })).toBeInTheDocument();
  });

  it("keeps drafts in review when the bulk import response includes failures", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 2,
            duplicates_removed: 0,
            high_confidence: 2,
            medium_confidence: 0,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 2,
            approved: 0,
            skipped: 0,
            incomplete_choice_count: 0,
            visual_retry_recommended: false,
          },
          drafts: [
            { ...baseDraft, draft_id: "ok-1", content_text: "题目一" },
            { ...baseDraft, draft_id: "ok-2", content_text: "题目二" },
          ],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse([]))
      .mockResolvedValueOnce(mockJsonResponse({ created: 1, existing: 0, failed: 1 }));

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "导入 2 道题目" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂不关联" }));

    expect(await screen.findByText("题目导入完成")).toBeInTheDocument();
    expect(screen.getByText("本次导入")).toBeInTheDocument();
    expect(screen.getByText("成功入库")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("removes all importable drafts only when bulk import has no failures", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 2,
            duplicates_removed: 0,
            high_confidence: 2,
            medium_confidence: 0,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 2,
            approved: 0,
            skipped: 0,
            incomplete_choice_count: 0,
            visual_retry_recommended: false,
          },
          drafts: [
            { ...baseDraft, draft_id: "ok-1", content_text: "题目一" },
            { ...baseDraft, draft_id: "ok-2", content_text: "题目二" },
          ],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse([]))
      .mockResolvedValueOnce(mockJsonResponse({ created: 1, existing: 1, failed: 0 }));

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "导入 2 道题目" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂不关联" }));

    expect(await screen.findByText("题目导入完成")).toBeInTheDocument();
    expect(screen.queryByText("核对导入内容")).not.toBeInTheDocument();
  });

  it("uses the selected question bank from the question list as the default import target", async () => {
    window.history.pushState({}, "", "/questions/import?question_bank_id=bank-from-list");
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 1,
            high_confidence: 0,
            medium_confidence: 1,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 1,
            approved: 0,
            skipped: 0,
          },
          drafts: [{ ...baseDraft, review_status: "pending" }],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse([]))
      .mockResolvedValueOnce(mockJsonResponse({ created: 1, existing: 0, failed: 0 }));

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "导入 1 道题目" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂不关联" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls).toEqual(
        expect.arrayContaining([
          [
            "/api/questions/bulk",
            expect.objectContaining({
              body: expect.stringContaining('"question_bank_id":"bank-from-list"'),
            }),
          ],
        ]),
      );
    });
    expect(await screen.findByText("题目导入完成")).toBeInTheDocument();
    expect(screen.getByText("本次导入")).toBeInTheDocument();
    expect(screen.getByText("成功入库")).toBeInTheDocument();
    expect(screen.getByText("数据库已存在")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看题目列表" }));
    expect(navigateMock).toHaveBeenCalledWith("/questions");
  });

  it("shows the primary import action in the top bar", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 1,
          high_confidence: 0,
          medium_confidence: 1,
          low_confidence: 0,
          issue_count: 0,
          pending_review: 1,
          approved: 0,
          skipped: 0,
        },
        drafts: [{ ...baseDraft }],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");

    expect(screen.getByRole("button", { name: "导入 1 道题目" })).toBeInTheDocument();
  });

  it("excludes blocking abnormal drafts from the import count", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 2,
          high_confidence: 0,
          medium_confidence: 2,
          low_confidence: 0,
          issue_count: 1,
          pending_review: 2,
          approved: 0,
          skipped: 0,
        },
        drafts: [
          { ...baseDraft, draft_id: "ok" },
          { ...baseDraft, draft_id: "abnormal", issues: ["题型不确定"] },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");

    expect(screen.getByRole("button", { name: "导入 1 道题目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解析异常.*1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认并下一题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 补全当前题" })).not.toBeInTheDocument();
  });

  it("opens the question edit form dialog for each question card", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 1,
          high_confidence: 0,
          medium_confidence: 1,
          low_confidence: 0,
          issue_count: 0,
          pending_review: 1,
          approved: 0,
          skipped: 0,
        },
        drafts: [{ ...baseDraft }],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // 现在复用题库的「修改题目」表单（QuestionEditFormContent），不再是编辑/预览选项卡。
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("编辑题目");
    expect(dialog).toHaveTextContent("题目内容");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
  });

  it("allows opening the import flow directly from fast mode when non-blocking drafts exist", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          mode: "smart",
          summary: {
            total: 1,
            high_confidence: 0,
            medium_confidence: 1,
            low_confidence: 0,
            issue_count: 0,
            pending_review: 1,
            approved: 0,
            skipped: 0,
          },
          drafts: [{ ...baseDraft, review_status: "pending" }],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse([]));

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "导入 1 道题目" }));

    expect(await screen.findByText("选择主知识点")).toBeInTheDocument();
  });

  it("filters questions by warning cards and search text", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        mode: "smart",
        summary: {
          total: 3,
          high_confidence: 0,
          medium_confidence: 3,
          low_confidence: 0,
          issue_count: 2,
          pending_review: 3,
          approved: 0,
          skipped: 0,
        },
        drafts: [
          { ...baseDraft, draft_id: "ok", content_text: "正常题目" },
          { ...baseDraft, draft_id: "missing", content_text: "没有答案的题目", answer_text: null, issues: ["未识别到答案"] },
          { ...baseDraft, draft_id: "abnormal", content_text: "异常题目", issues: ["题型不确定"] },
        ],
      }),
    );

    renderImportPage();

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /无答案.*1/ }));
    expect(screen.getByText("没有答案的题目")).toBeInTheDocument();
    expect(screen.queryByText("异常题目")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索题目内容、答案、解析或选项..."), {
      target: { value: "没有答案" },
    });
    expect(screen.getByText("没有答案的题目")).toBeInTheDocument();
  });
});
