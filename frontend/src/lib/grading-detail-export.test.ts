import { describe, expect, it } from "vitest";

import type { GradingDetailExportResponse } from "@/pages/grading/api";

import {
  buildGradingDetailExportHtml,
  buildGradingDetailExportSheets,
} from "./grading-detail-export";

const payload: GradingDetailExportResponse = {
  exam_id: "exam-1",
  exam_label: "期中考试",
  generated_at: "2026-08-27T09:00:00Z",
  questions: [
    {
      question_id: "question-1",
      question_label: "第 1 题",
      question_type: "short_answer",
      question_type_label: "论述题",
      question_content: "What is idempotency?",
      order: 1,
      max_score: 10,
      standard_answer: JSON.stringify({
        reference_code: "-- 创建数据库并切换数据库\nCREATE DATABASE library_db;\nUSE library_db;",
      }),
      analysis: "Explain the core definition.",
      rubric_definition: {
        source: "system_default",
        version: "2026-05-subjective-rubric-v1",
        dimensions: [{
          key: "coverage",
          label: "要点覆盖度",
          weight: 1,
          criteria: "是否完整说明重复请求的业务结果。",
          max_score: 10,
        }],
      },
      scoring_points: [{ point: "核心定义", score: 10 }],
      dimension_weights: { coverage: 1 },
      deduction_rules: [{ rule: "遗漏核心定义" }],
      fatal_error_rules: [],
    },
    {
      question_id: "question-2",
      question_label: "第 9 题",
      question_type: "true_false",
      question_type_label: "判断题",
      question_content: "HTTP GET requests should be safe.",
      order: 2,
      max_score: 2,
      standard_answer: "正确",
      analysis: "",
      rubric_definition: {},
      scoring_points: [],
      dimension_weights: {},
      deduction_rules: [],
      fatal_error_rules: [],
    },
  ],
  students: [{
    student_id: "student-1",
    candidate_name: "张三",
    candidate_code: "S001",
    submitted_at: "2026-08-27T08:00:00Z",
    objective_score: 2,
    subjective_score: 8,
    total_score: 10,
    recorded_total_score: 9,
    score_difference: 1,
    score_consistent: false,
    account_flags: ["疑似测试账号"],
    teacher_comment: "注意说明重复请求的效果。",
    answers: [
      {
        question_id: "question-1",
        question_label: "第 1 题",
        question_type: "short_answer",
        question_type_label: "论述题",
        max_score: 10,
        answer_text: "It can be repeated safely. ".repeat(10),
        score_awarded: 8,
        is_correct: false,
        grading_status: "已批改",
        dimension_scores: { coverage: 8 },
        dimension_comments: { coverage: "覆盖了主要概念。" },
        deduction_reasons: ["未解释相同效果"],
        strengths: ["回答简洁"],
        improvement_suggestions: ["补充效果一致性"],
        risk_flags: [],
        feedback_text: "定义正确但不完整。",
        teacher_comment: "",
        score_source: "人工调整",
        manual_score_reason: "教师复核后调整",
        programming_language: "",
        custom_input: "",
        model_label: "评分模型 A",
        prompt_template_version: "rubric-v1",
        role_binding_version: 3,
        scoring_evidence: { summary: "覆盖核心定义" },
        execution_evidence: {},
        answer_quality_flags: [],
      },
      {
        question_id: "question-2",
        question_label: "第 9 题",
        question_type: "true_false",
        question_type_label: "判断题",
        max_score: 2,
        answer_text: "正确",
        score_awarded: 2,
        is_correct: true,
        grading_status: "自动判分",
        dimension_scores: {},
        dimension_comments: {},
        deduction_reasons: [],
        strengths: [],
        improvement_suggestions: [],
        risk_flags: [],
        feedback_text: "",
        teacher_comment: "",
        score_source: "自动判分",
        manual_score_reason: "",
        programming_language: "",
        custom_input: "",
        model_label: "",
        prompt_template_version: "",
        role_binding_version: null,
        scoring_evidence: {},
        execution_evidence: {},
        answer_quality_flags: [],
      },
    ],
  }],
};

describe("buildGradingDetailExportHtml", () => {
  it("renders the requested question hierarchy and keeps subjective details scoped", () => {
    const html = buildGradingDetailExportHtml(payload);

    expect(html).toContain("评分维度");
    expect(html).toContain("要点覆盖度");
    expect(html).toContain('class="toc"');
    expect(html).toContain('href="#exam-overview"');
    expect(html).toContain('href="#student-score-table"');
    const document = new DOMParser().parseFromString(html, "text/html");
    const typeGroups = [...document.querySelectorAll<HTMLDetailsElement>(".toc-type-group")];
    expect(typeGroups).toHaveLength(2);
    expect(typeGroups.every((group) => group.open)).toBe(true);
    typeGroups[0].open = false;
    expect(typeGroups[0].open).toBe(false);
    expect(document.querySelector('[href="#question-question-2"]')?.textContent).toBe("第 1 题");
    expect(html).toContain("<h3>第 9 题</h3>");
    expect(html).toContain('href="#question-question-1-rubric"');
    expect(html).toContain('href="#question-question-1-dimensions"');
    expect(html).toContain('href="#question-question-1-feedback"');
    expect(html).toContain('href="#question-question-2-answers"');
    expect(html).toContain('href="#question-question-2-summary"');
    expect(html).not.toContain('href="#question-question-2-rubric"');
    expect(html.indexOf('id="type-true_false"')).toBeLessThan(html.indexOf('id="type-essay"'));
    expect(html).toContain("所有考生总结分析");
    expect(html).toContain("font:700 28px/1.3");
    expect(html).toContain("What is idempotency?");
    expect(html).toContain("学生分数表");
    expect(html).toContain("姓名");
    expect(html).toContain("学号");
    expect(html).toContain("提交时间");
    expect(html).toContain("状态");
    expect(html).toContain("论述题得分");
    expect(html).toContain("判断题得分");
    expect(html).toContain("8 / 10");
    expect(html).toContain("2 / 2");
    expect(html).toContain("10 / 12");
    expect(html).not.toContain("总分校验");
    expect(html).toContain("疑似测试账号");
    expect(html).toContain("逐人明细");
    expect(html).toContain("人工调分原因");
    expect(html).toContain("教师复核后调整");
    expect(html).toContain("数据口径与质量提示");
    expect(html).not.toContain("错误/待改进");
    expect(html).toContain('class="reference-code"');
    expect(html).toContain("CREATE DATABASE library_db;");
    expect(html).toContain('class="rubric-dimension"');
    expect(html).toContain("是否完整说明重复请求的业务结果。");
    expect(html).not.toContain("&quot;reference_code&quot;");
    expect(html).not.toContain("&quot;dimensions&quot;");
    expect(html).toContain("It can be repeated safely.");
    expect(html).toContain('class="cell-details"');
    expect(html).toContain("查看全文");
  });

  it("separates code metadata and makes missing execution evidence explicit", () => {
    const codePayload = structuredClone(payload);
    codePayload.questions[0].question_type = "code";
    codePayload.questions[0].question_type_label = "编程题";
    codePayload.students[0].answers[0].question_type = "code";
    codePayload.students[0].answers[0].question_type_label = "编程题";
    codePayload.students[0].answers[0].answer_text = "print(0)";
    codePayload.students[0].answers[0].programming_language = "python";
    codePayload.students[0].answers[0].custom_input = "1 2";
    codePayload.students[0].answers[0].answer_quality_flags = ["历史评分输入曾混入编程语言或运行输入；本报告已分栏还原"];

    const html = buildGradingDetailExportHtml(codePayload);

    expect(html).toContain('href="#question-question-1-evidence"');
    expect(html).toContain("执行与评分证据");
    expect(html).toContain("未记录可复现的编译、运行或测试证据");
    expect(html).toContain("历史评分输入曾混入编程语言或运行输入；本报告已分栏还原");
  });

  it("builds a readable Excel score table and per-person dimension sheet", () => {
    const sheets = buildGradingDetailExportSheets(payload);
    const scoreSheet = sheets.find((sheet) => sheet.name === "学生分数表");
    const dimensionSheet = sheets.find((sheet) => sheet.name === "维度得分分析");

    expect(scoreSheet?.rows[0]).toContain("总分");
    expect(scoreSheet?.rows[0]).not.toContain("总分校验");
    expect(scoreSheet?.rows[0]).not.toContain("原记录总分");
    expect(dimensionSheet?.rows[0]).toContain("维度合计");
    expect(dimensionSheet?.rows[0]).toContain("人工调分原因");
    expect(dimensionSheet?.rows[1]).toContain("教师复核后调整");
    expect(sheets.every((sheet) => sheet.rows[0].length === sheet.widths.length)).toBe(true);
  });

  it("uses the rubric's explicit dimension maximum when it differs from the weight fallback", () => {
    const customPayload: GradingDetailExportResponse = {
      ...payload,
      questions: payload.questions.map((question) => question.question_id === "question-1"
        ? {
          ...question,
          rubric_definition: {
            dimensions: [{
              key: "coverage",
              label: "要点覆盖度",
              weight: 1,
              max_score: 2,
            }],
          },
          dimension_weights: { coverage: 1 },
        }
        : question),
      students: payload.students.map((student) => ({
        ...student,
        answers: student.answers.map((answer) => answer.question_id === "question-1"
          ? { ...answer, score_awarded: 2, dimension_scores: { coverage: 2 } }
          : answer),
      })),
    };

    const html = buildGradingDetailExportHtml(customPayload);

    expect(html).toContain("2 / 2");
  });
});
