import { render, screen, fireEvent, waitFor } from "@/test/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionImportDraft } from "./import-types";
import { QuestionImportPage } from "./import";
import {
  applySourceDraftEdits,
  approveAllPendingDrafts,
  buildStandardImportTemplate,
  buildImportableQuestions,
  buildImportSummary,
  canApproveAllDrafts,
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
  vi.stubGlobal("fetch", fetchMock);
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

  it("blocks bulk approval when any pending draft has blocking abnormal issues", () => {
    expect(
      canApproveAllDrafts([
        { ...baseDraft, draft_id: "pending-1", review_status: "pending" },
        { ...baseDraft, draft_id: "abnormal", issues: ["题型不确定"], review_status: "pending" },
      ]),
    ).toBe(false);
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

  it("preserves docx paragraph and ordered-list boundaries so multiple questions stay separable", () => {
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
    expect(text).toContain("- 提交 PDM 截图；");
    expect(text).toContain("- 提交 MySQL 脚本截图；");
    expect(text).toContain("\n\n2. 请提交今日课堂作业：");
    expect(text).not.toContain("提交 PDM 截图；提交 MySQL 脚本截图；");
  });
});

describe("QuestionImportPage", () => {
  it("keeps the upload screen focused on file selection", () => {
    render(<QuestionImportPage />);

    expect(screen.getByRole("button", { name: "选择本地文件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "快速识别" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 一键分析整个文件" })).not.toBeInTheDocument();
  });

  it("shows ai-full loading text while analyzing from the review screen", async () => {
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
          drafts: [{ ...baseDraft }],
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve(
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
                    drafts: [{ ...baseDraft, segment_source: "ai_full+rule" }],
                  }),
                ),
              20,
            );
          }),
      );

    render(<QuestionImportPage />);

    const file = new File(["1. 单选题 示例\nA. 选项A\nB. 选项B\n答案：A"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 一键分析" }));

    expect(await screen.findByText("AI 正在分析整份导入内容")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops loading immediately when review-screen ai analysis fails", async () => {
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
          drafts: [{ ...baseDraft }],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ detail: "AI 分析结果格式异常，请重试" }, false));

    render(<QuestionImportPage />);

    const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("question-import-file-input"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("核对导入内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 一键分析" }));

    expect(await screen.findByText("AI 分析结果格式异常，请重试")).toBeInTheDocument();
    expect(screen.queryByText("AI 正在分析整份导入内容")).not.toBeInTheDocument();
  });
});
