import { describe, expect, it } from "vitest";

import type { IQuestion, QuestionType } from "@/types";

import { getQuestionDisplayType } from "@/components/questions/question-preview-utils";

import {
  ALL_DIFFICULTIES,
  buildSmartPracticeConversationPrompt,
  collectKnowledgeScopeIds,
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

  it("优先解析选取数量，不把当前题库总量当成目标题量", () => {
    expect(
      parseSmartPracticePrompt(
        "从当前220到题目中选取60到题作为练习，要求各种题型都需要，并且难度也适中",
        knowledgeOptions,
        { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
      ).count,
    ).toBe(60);
  });

  it("按提示词中的题型数量严格选题", () => {
    const intent = parseSmartPracticePrompt(
      "生成5道选择题和5道简答题",
      knowledgeOptions,
      { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
    );
    const source = [
      ...Array.from({ length: 8 }, (_, index) => question(`choice-${index}`, "choice", 3)),
      ...Array.from({ length: 8 }, (_, index) => question(`short-${index}`, "short_answer", 3)),
    ];

    expect(intent.count).toBe(10);
    expect(
      selectSmartPracticeQuestions(source, intent).reduce<Record<string, number>>(
        (counts, item) => ({ ...counts, [item.type]: (counts[item.type] ?? 0) + 1 }),
        {},
      ),
    ).toEqual({ choice: 5, short_answer: 5 });
  });

  it("按题型配比时单选和多选分别取题", () => {
    const source = [
      question("s1", "choice", 3),
      question("s2", "choice", 3),
      { ...question("m1", "choice", 3), content: { text: "m1 数据结构多选题", multi: true } },
      { ...question("m2", "choice", 3), content: { text: "m2 数据结构多选题", multi: true } },
      question("t1", "true_false", 3),
      question("f1", "fill_in", 3),
    ];
    const intent = parseSmartPracticePrompt(
      "请从题库中选取单选题2道、多选题1道、判断题1道，综合难度。",
      knowledgeOptions,
      { count: 10, difficulty: 1, knowledgePointId: null },
    );

    expect(intent.count).toBe(4);
    expect(intent.difficulty).toBe(ALL_DIFFICULTIES);
    expect(intent.typeDistribution).toEqual({
      single_choice: 2,
      multi_choice: 1,
      true_false: 1,
    });

    const picked = selectSmartPracticeQuestions(source, intent);
    const counts = picked.reduce<Record<string, number>>((result, item) => {
      const key = getQuestionDisplayType(item) ?? item.type;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ single_choice: 2, multi_choice: 1, true_false: 1 });
  });

  describe("按比例出题", () => {
    const chapterSource = () => [
      ...Array.from({ length: 4 }, (_, index) =>
        question(`a-c-${index}`, "choice", 3, "kp-a"),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`a-t-${index}`, "true_false", 3, "kp-a"),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`b-c-${index}`, "choice", 3, "kp-b"),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`b-t-${index}`, "true_false", 3, "kp-b"),
      ),
    ];
    const chapterOptions = [
      { id: "kp-a", name: "章节A", path: "课程 / 章节A" },
      { id: "kp-b", name: "章节B", path: "课程 / 章节B" },
    ];

    it("章节题量 + 题型比例", () => {
      const intent = parseSmartPracticePrompt(
        "请从“数据结构”题库中选取10道题，按章节分配：章节A6题、章节B4题；题型比例：单选题60%、判断题40%。",
        chapterOptions,
        { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
      );

      expect(intent.count).toBe(10);
      expect(intent.chapters).toEqual([
        { knowledgePointId: "kp-a", count: 6 },
        { knowledgePointId: "kp-b", count: 4 },
      ]);
      expect(intent.typeWeights).toEqual([
        { type: "single_choice", weight: 60 },
        { type: "true_false", weight: 40 },
      ]);

      const picked = selectSmartPracticeQuestions(chapterSource(), intent);
      expect(picked).toHaveLength(10);
      expect(
        picked.filter((item) => item.knowledge_points[0]?.id === "kp-a"),
      ).toHaveLength(6);
      expect(
        picked.reduce<Record<string, number>>((counts, item) => {
          counts[item.type] = (counts[item.type] ?? 0) + 1;
          return counts;
        }, {}),
      ).toEqual({ choice: 6, true_false: 4 });
    });

    it("题型题量 + 章节比例", () => {
      const intent = parseSmartPracticePrompt(
        "请从“数据结构”题库中选取10道题，按题型数量：单选题6道、判断题4道；章节比例：章节A60%、章节B40%。",
        chapterOptions,
        { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
      );

      expect(intent.typeDistribution).toEqual({
        single_choice: 6,
        true_false: 4,
      });
      expect(intent.chapters).toEqual([
        { knowledgePointId: "kp-a", weight: 60 },
        { knowledgePointId: "kp-b", weight: 40 },
      ]);

      const picked = selectSmartPracticeQuestions(chapterSource(), intent);
      expect(picked).toHaveLength(10);
      expect(
        picked.filter((item) => item.knowledge_points[0]?.id === "kp-a"),
      ).toHaveLength(6);
      expect(
        picked.reduce<Record<string, number>>((counts, item) => {
          counts[item.type] = (counts[item.type] ?? 0) + 1;
          return counts;
        }, {}),
      ).toEqual({ choice: 6, true_false: 4 });
    });
  });

  it("按章节分配：章节题量 + 章节内各题型题量", () => {
    const source = [
      ...Array.from({ length: 5 }, (_, index) =>
        question(`a-c-${index}`, "choice", 3, "kp-a"),
      ),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...question(`a-m-${index}`, "choice", 3, "kp-a"),
        content: { text: `a-m-${index} 多选题`, multi: true },
      })),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`a-t-${index}`, "true_false", 3, "kp-a"),
      ),
      question("a-s-0", "short_answer", 3, "kp-a"),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`b-c-${index}`, "choice", 3, "kp-b"),
      ),
      question("b-t-0", "true_false", 3, "kp-b"),
    ];

    const intent = parseSmartPracticePrompt(
      "请从“数据结构”题库中按章节分配：章节A10道（单选题5道、多选题2道、判断题2道、简答题1道）；章节B3道（单选题2道、判断题1道）。",
      [
        { id: "kp-a", name: "章节A", path: "课程 / 章节A" },
        { id: "kp-b", name: "章节B", path: "课程 / 章节B" },
      ],
      { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
    );

    expect(intent.count).toBe(13);
    expect(intent.chapters).toHaveLength(2);
    expect(intent.chapters?.[0].typeCounts).toEqual({
      single_choice: 5,
      multi_choice: 2,
      true_false: 2,
      short_answer: 1,
    });

    const picked = selectSmartPracticeQuestions(source, intent);
    expect(picked).toHaveLength(13);
    expect(
      picked.reduce<Record<string, number>>((counts, item) => {
        const key = getQuestionDisplayType(item) ?? item.type;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      single_choice: 7,
      multi_choice: 2,
      true_false: 3,
      short_answer: 1,
    });
  });

  it("按章节分配里的「整个课程」", () => {
    const intent = parseSmartPracticePrompt(
      "请从“数据结构”题库中按章节分配：整个课程10道（单选题6道、判断题4道）。",
      [
        { id: "kp-a", name: "章节A", path: "课程 / 章节A" },
        { id: "kp-b", name: "章节B", path: "课程 / 章节B" },
      ],
      { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
    );

    expect(intent.count).toBe(10);
    expect(intent.chapters).toEqual([
      {
        knowledgePointId: "__whole_course__",
        count: 10,
        typeCounts: { single_choice: 6, true_false: 4 },
      },
    ]);
  });

  it("按题型分配：题型题量 + 题型下各章节题量", () => {
    const source = [
      ...Array.from({ length: 3 }, (_, index) =>
        question(`a-c-${index}`, "choice", 3, "kp-a"),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        question(`a-t-${index}`, "true_false", 3, "kp-a"),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        question(`b-c-${index}`, "choice", 3, "kp-b"),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        question(`c-c-${index}`, "choice", 3, "kp-c"),
      ),
    ];

    const intent = parseSmartPracticePrompt(
      "请从“数据结构”题库中按题型分配：单选题10道（章节A3道、章节B5道、章节C2道）；判断题3道（章节A3道）。",
      [
        { id: "kp-a", name: "章节A", path: "课程 / 章节A" },
        { id: "kp-b", name: "章节B", path: "课程 / 章节B" },
        { id: "kp-c", name: "章节C", path: "课程 / 章节C" },
      ],
      { count: 10, difficulty: ALL_DIFFICULTIES, knowledgePointId: null },
    );

    expect(intent.count).toBe(13);
    expect(intent.typeGroups).toHaveLength(2);
    expect(intent.typeGroups?.[0]).toEqual({
      type: "single_choice",
      chapterCounts: [
        { knowledgePointId: "kp-a", count: 3 },
        { knowledgePointId: "kp-b", count: 5 },
        { knowledgePointId: "kp-c", count: 2 },
      ],
    });

    const picked = selectSmartPracticeQuestions(source, intent);
    expect(picked).toHaveLength(13);
    expect(
      picked.filter((item) => item.type === "true_false"),
    ).toHaveLength(3);
    expect(
      picked.reduce<Record<string, number>>((counts, item) => {
        counts[item.knowledge_points[0]?.id ?? ""] =
          (counts[item.knowledge_points[0]?.id ?? ""] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ "kp-a": 6, "kp-b": 5, "kp-c": 2 });
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

  it("多轮提示词支持 60 道题", () => {
    expect(
      parseSmartPracticeChatPrompt("改为选取60到题", knowledgeOptions, {
        count: 10,
        difficulty: 3,
        knowledgePointId: "kp-1",
      }).count,
    ).toBe(60);
  });

  const chapterOptions = [
    { id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" },
    {
      id: "kp-media",
      name: "传输介质",
      path: "计算机网络 / 物理层 / 传输介质",
    },
    {
      id: "kp-multiplex",
      name: "信道复用",
      path: "计算机网络 / 物理层 / 信道复用",
    },
    { id: "kp-network", name: "网络层", path: "计算机网络 / 网络层" },
  ];

  it("知识点取题范围包含选中节点自身及其所有子知识点", () => {
    expect(collectKnowledgeScopeIds("kp-physical", chapterOptions)).toEqual([
      "kp-physical",
      "kp-media",
      "kp-multiplex",
    ]);
    expect(collectKnowledgeScopeIds("kp-media", chapterOptions)).toEqual([
      "kp-media",
    ]);
    expect(collectKnowledgeScopeIds(null, chapterOptions)).toEqual([]);
    // 选项里没有这个节点时，退化为只匹配它自己，避免意外放开范围。
    expect(collectKnowledgeScopeIds("kp-unknown", chapterOptions)).toEqual([
      "kp-unknown",
    ]);
  });

  it("选中上级知识点时把子知识点的题目一起选题，但不误收兄弟节点", () => {
    const source = [
      question("a", "choice", 1, "kp-physical"),
      question("b", "choice", 1, "kp-media"),
      question("c", "choice", 1, "kp-multiplex"),
      question("d", "choice", 1, "kp-network"),
    ];
    const picked = selectSmartPracticeQuestions(source, {
      count: 10,
      difficulty: 1,
      knowledgePointId: "kp-physical",
      knowledgePointIds: collectKnowledgeScopeIds(
        "kp-physical",
        chapterOptions,
      ),
      searchTerms: [],
    });

    expect(new Set(picked.map((item) => item.id))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  it("未传范围 ids 时仍按单个知识点精确筛选", () => {
    const source = [
      question("a", "choice", 1, "kp-physical"),
      question("b", "choice", 1, "kp-media"),
    ];
    const picked = selectSmartPracticeQuestions(source, {
      count: 10,
      difficulty: 1,
      knowledgePointId: "kp-physical",
      searchTerms: [],
    });

    expect(picked.map((item) => item.id)).toEqual(["a"]);
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
