import { describe, expect, it } from "vitest";

import type { QuestionImportDraft } from "./import-types";
import { buildImportableQuestions, buildImportSummary, importTextToHtml } from "./import-utils";

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
});
