import { render, screen, fireEvent, waitFor } from "@/test/test-utils";
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
    useList: () => useListMock(),
  };
});

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

    expect(template).toContain("很容易 = 1");
    expect(template).toContain("[题型] 选择题");
    expect(template).toContain("[答案] A");
    expect(template).toContain("[解析] 北京是中国首都。");
    expect(template).toContain("[难度] 一般");
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
      <p>1. 请提交今日课堂作业：</p>
      <ol>
        <li>提交 PDM 截图；</li>
        <li>提交 MySQL 脚本截图；</li>
      </ol>
      <p>要求写出截图标题，截图清晰。</p>
      <p>[答案]</p>
      <p>[难度] 简单</p>
      <p>[预计时间]</p>
      <p>2. 请提交今日课堂作业：</p>
      <ol>
        <li>提交功能模块图；</li>
        <li>提交概念数据模型 E-R 图；</li>
      </ol>
      <p>[答案]</p>
      <p>[难度] 简单</p>
    `;

    const text = htmlToImportText(html);

    expect(text).toContain("1. 请提交今日课堂作业：");
    expect(text).toContain("[OL] 提交 PDM 截图；");
    expect(text).toContain("[OL] 提交 MySQL 脚本截图；");
    expect(text).toContain("\n\n2. 请提交今日课堂作业：");
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
  it("keeps the upload screen focused on file selection", () => {
    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 1 道题目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部题目 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择题 1" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索题目内容、答案、解析或选项...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开查看答案" })).not.toBeInTheDocument();
    expect(screen.getByText(/答案：/)).toBeInTheDocument();
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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

    const file = new File(["docx-body"], "questions.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/当前 Word 文档可能使用了自动编号/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions/import/document-recognize",
      expect.objectContaining({
        body: expect.stringContaining('"tables":[{"order":1,"rows":[["题号","一"]]}]'),
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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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

  it("opens a dialog editor with preview for each question card", async () => {
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

    render(<QuestionImportPage />);

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    await screen.findByText("核对导入内容");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("编辑题目");
    expect(screen.getByRole("tab", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "预览" })).toBeInTheDocument();
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

    render(<QuestionImportPage />);

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

    render(<QuestionImportPage />);

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
