import { describe, expect, it } from "vitest";

import { AI_MODEL_OPTIONS } from "@/components/questions/ai-question-config-constants";
import type { IQuestion } from "@/types";

import {
  buildExamAnswerAnalysisPrompt,
  buildExamAIReplacementKnowledgePointIds,
  buildExamAIReplacementPrompt,
} from "./ExamQuestionActions";

const baseQuestion: IQuestion = {
  id: "question-1",
  type: "code",
  title: "判断闰年",
  content: { text: "编写一个 Python 程序，输入年份并判断是否为闰年。" },
  options: null,
  answer: { text: "year = int(input())\nprint(year % 4 == 0 and year % 100 != 0 or year % 400 == 0)" },
  analysis: "考查条件判断与布尔表达式。",
  difficulty: 3,
  score: 10,
  usage_count: 0,
  question_bank_id: "bank-1",
  question_bank_name: "Python程序设计-题库",
  tags: [],
  knowledge_points: [
    {
      id: "kp-child-1",
      name: "程序流程控制",
      parent_id: "course-kp-1",
      direction_id: "direction-1",
      description: null,
      question_count: 0,
      created_at: "2026-06-04T00:00:00.000Z",
    },
  ],
  created_by: "teacher-1",
  created_by_name: "老师",
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: "2026-06-04T00:00:00.000Z",
};

describe("exam AI replacement configuration", () => {
  it("shows DeepSeek first and uses v4 flash as the displayed default model", () => {
    expect(AI_MODEL_OPTIONS.map((option) => option.value)).toEqual([
      "deepseek",
      "qwen",
      "claude",
    ]);
    expect(AI_MODEL_OPTIONS[0].desc).toBe("deepseek-v4-flash");
  });

  it("keeps AI replacement scoped to the original child knowledge point", () => {
    expect(
      buildExamAIReplacementKnowledgePointIds(baseQuestion, "course-kp-1"),
    ).toEqual(["kp-child-1"]);
  });

  it("falls back to the course root knowledge point when the original question has no child point", () => {
    expect(
      buildExamAIReplacementKnowledgePointIds(
        { ...baseQuestion, knowledge_points: [] },
        "course-kp-1",
      ),
    ).toEqual(["course-kp-1"]);
  });

  it("includes the original question context and forbids unrelated subjects", () => {
    const prompt = buildExamAIReplacementPrompt(baseQuestion);

    expect(prompt).toContain("同一课程/主知识点");
    expect(prompt).toContain("同一子知识点");
    expect(prompt).toContain("严禁生成语文");
    expect(prompt).toContain("原题题型：编程题");
    expect(prompt).toContain("程序流程控制");
    expect(prompt).toContain("编写一个 Python 程序");
    expect(prompt).toContain("answer.text 必须包含");
    expect(prompt.length).toBeLessThanOrEqual(1900);
  });

  it("requires per-option analysis when regenerating answer and analysis for choice questions", () => {
    const prompt = buildExamAnswerAnalysisPrompt({
      ...baseQuestion,
      type: "choice",
      content: { text: "Python 中用于定义函数的关键字是？" },
      options: { A: "def", B: "class", C: "import", D: "return" },
      answer: { correct: "A" },
      analysis: "def 用于定义函数。",
    });

    expect(prompt).toContain("只重新判断 answer 与 analysis");
    expect(prompt).toContain("必须逐项说明每个选项为什么正确或为什么错误");
    expect(prompt).toContain("Python 中用于定义函数");
    expect(prompt.length).toBeLessThanOrEqual(1900);
  });
});
