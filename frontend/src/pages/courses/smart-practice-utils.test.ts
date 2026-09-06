import { describe, expect, it } from "vitest";

import type { IQuestion, QuestionType } from "@/types";

import {
  ALL_DIFFICULTIES,
  buildSmartPracticeConversationPrompt,
  parseSmartPracticeChatPrompt,
  parseSmartPracticePrompt,
  selectSmartPracticeQuestions,
} from "./smart-practice-utils";

function question(
  id: string,
  type: QuestionType,
  difficulty: number,
  knowledgePointId = "kp-1",
): IQuestion {
  return {
    id,
    type,
    title: `${id} 数据结构`,
    content: { text: `${id} 数据结构题目` },
    options: null,
    answer: {},
    analysis: null,
    difficulty,
    score: 5,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "课程题库",
    tags: [],
    knowledge_points: [
      {
        id: knowledgePointId,
        name: knowledgePointId === "kp-1" ? "线性表" : "树",
        parent_id: null,
        description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    created_by: "teacher-1",
    created_by_name: "教师",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("smart practice selection", () => {
  const knowledgeOptions = [
    { id: "kp-1", name: "线性表", path: "数据结构 / 线性表" },
    { id: "kp-2", name: "树", path: "数据结构 / 树" },
  ];

  it("从提示词解析题量、难度和知识点", () => {
    const intent = parseSmartPracticePrompt(
      "请为线性表生成20道容易题",
      knowledgeOptions,
      { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
    );

    expect(intent).toMatchObject({
      count: 20,
      difficulty: 1,
      knowledgePointId: "kp-1",
    });
  });

  it("综合难度不会被误判为中等", () => {
    const intent = parseSmartPracticePrompt(
      "生成10道综合难度题",
      knowledgeOptions,
      { count: 5, difficulty: 2, knowledgePointId: null },
    );

    expect(intent.difficulty).toBe(ALL_DIFFICULTIES);
  });

  it("严格按知识点和难度筛选并尽量均衡题型", () => {
    const source = [
      question("a", "choice", 1),
      question("b", "choice", 1),
      question("c", "true_false", 1),
      question("d", "short_answer", 1),
      question("e", "choice", 3),
      question("f", "choice", 1, "kp-2"),
    ];
    const picked = selectSmartPracticeQuestions(source, {
      count: 3,
      difficulty: 1,
      knowledgePointId: "kp-1",
      searchTerms: [],
    });

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((item) => item.type))).toEqual(
      new Set(["choice", "true_false", "short_answer"]),
    );
  });

  it("多轮提示词沿用上一轮题量并支持相对调整", () => {
    expect(
      parseSmartPracticeChatPrompt("再难一点", knowledgeOptions, {
        count: 10,
        difficulty: 3,
        knowledgePointId: "kp-1",
      }),
    ).toMatchObject({ count: 10, difficulty: 4, knowledgePointId: "kp-1" });

    expect(
      parseSmartPracticeChatPrompt("减少 2 道", knowledgeOptions, {
        count: 10,
        difficulty: 3,
        knowledgePointId: "kp-1",
      }).count,
    ).toBe(8);
  });

  it("不会把更换第 4 题误判为生成 4 道题", () => {
    expect(
      parseSmartPracticeChatPrompt("更换一下第4题", knowledgeOptions, {
        count: 5,
        difficulty: 3,
        knowledgePointId: "kp-1",
      }).count,
    ).toBe(5);
  });

  it("将历史题单和最新要求组成完整更新提示词", () => {
    const prompt = buildSmartPracticeConversationPrompt(
      [
        {
          prompt: "生成 2 道选择题",
          questions: [{ type: "choice", title: "OSI 模型" }],
        },
      ],
      "再难一点",
    );

    expect(prompt).toContain("OSI 模型");
    expect(prompt).toContain("最新要求：再难一点");
    expect(prompt).toContain("完整题目列表");
  });
});
