import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

import type { QuestionImportDraft } from "./import-types";
import {
  allImportableDraftsHaveKnowledge,
  applyZipImageUrls,
  buildAnswerPayload,
  buildImportableQuestions,
  draftNeedsAnalysis,
  draftNeedsAnswer,
  draftNeedsKnowledge,
  getChoiceAnswerLetters,
  getDraftTypeFilter,
  getDraftTypeLabel,
  isMultiChoiceDraft,
  parseJsonKnowledgePointNames,
  parseJsonQuestions,
  extractQuestionImportPayload,
  selectEnhanceTargets,
} from "./import-utils";

function makeDraft(
  overrides: Partial<QuestionImportDraft> & { draft_id: string },
): QuestionImportDraft {
  return {
    raw_text: "",
    title: "题干",
    type: "choice",
    content_text: "题干",
    options: { A: "甲", B: "乙" },
    answer_text: "A",
    analysis: "",
    difficulty: 3,
    segment_source: "ai_full",
    type_confidence: "high",
    boundary_confidence: "high",
    issues: [],
    review_status: "pending",
    review_required: true,
    suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
    ...overrides,
  };
}

describe("selectEnhanceTargets", () => {
  const complete = makeDraft({ draft_id: "complete" });
  const missingAnswer = makeDraft({ draft_id: "missing-answer", answer_text: "  " });
  const missingKnowledge = makeDraft({
    draft_id: "missing-knowledge",
    suggested_knowledge_points: [],
  });
  const missingBoth = makeDraft({
    draft_id: "missing-both",
    answer_text: null,
    suggested_knowledge_points: [],
  });
  const drafts = [complete, missingAnswer, missingKnowledge, missingBoth];

  it("只补齐缺失时按完善方式筛选", () => {
    expect(selectEnhanceTargets(drafts, "answers", "missing").map((d) => d.draft_id)).toEqual([
      "missing-answer",
      "missing-both",
    ]);
    expect(selectEnhanceTargets(drafts, "knowledge", "missing").map((d) => d.draft_id)).toEqual([
      "missing-knowledge",
      "missing-both",
    ]);
    expect(selectEnhanceTargets(drafts, "both", "missing").map((d) => d.draft_id)).toEqual([
      "missing-answer",
      "missing-knowledge",
      "missing-both",
    ]);
  });

  it("全部题目范围下不做筛选", () => {
    expect(selectEnhanceTargets(drafts, "answers", "all")).toHaveLength(4);
    expect(selectEnhanceTargets(drafts, "both", "all")).toHaveLength(4);
  });

  it("识别缺失答案与缺失知识点", () => {
    expect(draftNeedsAnswer(complete)).toBe(false);
    expect(draftNeedsAnswer(missingAnswer)).toBe(true);
    expect(draftNeedsKnowledge(complete)).toBe(false);
    expect(draftNeedsKnowledge(missingKnowledge)).toBe(true);
  });

  it("JSON 题库原文标注了知识点的题目不算缺知识点", () => {
    // JSON 题库带的 knowledge_point_names 入库时会按名称匹配，不必再调模型。
    const recognizedOnly = makeDraft({
      draft_id: "recognized-only",
      segment_source: "client-json",
      suggested_knowledge_points: [],
      recognized_knowledge_points: ["地址解析协议 ARP"],
    });
    expect(draftNeedsKnowledge(recognizedOnly)).toBe(false);
    expect(
      selectEnhanceTargets([recognizedOnly, missingKnowledge], "knowledge", "missing")
        .map((d) => d.draft_id),
    ).toEqual(["missing-knowledge"]);

    // 文档识别出的名称只是线索，仍然算缺失。
    const recognizedHint = makeDraft({
      draft_id: "recognized-hint",
      segment_source: "ai_full",
      suggested_knowledge_points: [],
      recognized_knowledge_points: ["人工智能信息技术基础"],
    });
    expect(draftNeedsKnowledge(recognizedHint)).toBe(true);
  });
});

describe("selectEnhanceTargets · 完善题目解析", () => {
  // 两道题的答案与知识点都齐全，只区分解析有无。
  const withAnalysis = makeDraft({ draft_id: "with-analysis", analysis: "已有解析" });
  const withoutAnalysis = makeDraft({ draft_id: "without-analysis", analysis: "  " });
  const drafts = [withAnalysis, withoutAnalysis];

  it("仅补齐缺失时只挑出缺解析的题目", () => {
    expect(
      selectEnhanceTargets(drafts, "analysis", "missing").map((d) => d.draft_id),
    ).toEqual(["without-analysis"]);
  });

  it("全部题目范围下不筛选", () => {
    expect(selectEnhanceTargets(drafts, "analysis", "all")).toHaveLength(2);
  });

  it("识别缺失解析", () => {
    expect(draftNeedsAnalysis(withAnalysis)).toBe(false);
    expect(draftNeedsAnalysis(withoutAnalysis)).toBe(true);
  });
});

describe("选择题单选/多选拆分", () => {
  it("从答案文本解析选项字母", () => {
    expect(getChoiceAnswerLetters("A")).toEqual(["A"]);
    expect(getChoiceAnswerLetters("bd")).toEqual(["B", "D"]);
    expect(getChoiceAnswerLetters("A、C")).toEqual(["A", "C"]);
    expect(getChoiceAnswerLetters("A C")).toEqual(["A", "C"]);
    expect(getChoiceAnswerLetters("")).toEqual([]);
  });

  it("按答案字母数量区分单选与多选", () => {
    const single = makeDraft({ draft_id: "single", answer_text: "A" });
    const multi = makeDraft({ draft_id: "multi", answer_text: "BD" });
    const noAnswer = makeDraft({ draft_id: "no-answer", answer_text: null });

    expect(isMultiChoiceDraft(single)).toBe(false);
    expect(isMultiChoiceDraft(multi)).toBe(true);

    expect(getDraftTypeFilter(single)).toBe("single_choice");
    expect(getDraftTypeFilter(multi)).toBe("multi_choice");
    expect(getDraftTypeFilter(noAnswer)).toBe("single_choice");
    expect(getDraftTypeFilter(makeDraft({ draft_id: "tf", type: "true_false" }))).toBe("true_false");

    expect(getDraftTypeLabel(single)).toBe("单选题");
    expect(getDraftTypeLabel(multi)).toBe("多选题");
    expect(getDraftTypeLabel(makeDraft({ draft_id: "tf", type: "true_false" }))).toBe("判断题");
  });

  it("多选答案提交为数组并标记 multi", () => {
    expect(buildAnswerPayload("choice", "A")).toEqual({ correct: "A" });
    expect(buildAnswerPayload("choice", "BD")).toEqual({ correct: ["B", "D"] });
    expect(buildAnswerPayload("choice", "A、C")).toEqual({ correct: ["A", "C"] });
  });

  it("单空填空题不按逗号拆答案，多说法用 | 保留", () => {
    expect(
      buildAnswerPayload("fill_in", "1,024", "缓冲区默认大小是____ 字节。"),
    ).toEqual({ correct: ["1,024"] });
    expect(
      buildAnswerPayload("fill_in", "MAC地址|硬件地址", "网卡地址也叫____。"),
    ).toEqual({ correct: ["MAC地址|硬件地址"] });
  });

  it("多空填空题仍按逗号/分号分空", () => {
    expect(buildAnswerPayload("fill_in", "A,B", "____ 和 ____")).toEqual({
      correct: ["A", "B"],
    });
    expect(buildAnswerPayload("fill_in", "A；B", "____ 和 ____")).toEqual({
      correct: ["A", "B"],
    });
  });
});

describe("JSON 导入的 difficulty / analysis / knowledge_point_names", () => {
  const json = JSON.stringify({
    questions: [
      {
        type: "choice",
        title: "ARPANET 采用的核心交换技术是（ ）。",
        content: { text: "ARPANET 采用的核心交换技术是（ ）。", multi: false },
        options: { A: "电路交换", B: "分组交换" },
        answer: { correct: "B" },
        analysis: "分组交换是 ARPANET 的核心技术。",
        difficulty: 2,
        score: 1,
        knowledge_point_names: ["互联网的核心部分", "1.3.2 协议与划分层次", "互联网的核心部分"],
      },
    ],
  });

  it("把 difficulty、analysis、knowledge_point_names 带进草稿", () => {
    const { drafts } = parseJsonQuestions(json);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].difficulty).toBe(2);
    expect(drafts[0].analysis).toBe("分组交换是 ARPANET 的核心技术。");
    expect(drafts[0].recognized_knowledge_points).toEqual([
      "互联网的核心部分",
      "1.3.2 协议与划分层次",
    ]);
  });

  it("入库载荷带上标注的知识点名称，便于后端按名称匹配", () => {
    const { drafts } = parseJsonQuestions(json);
    const [question] = buildImportableQuestions(
      drafts.map((draft) => ({ ...draft, review_status: "approved" as const })),
      null,
    );
    expect(question.recognized_knowledge_points).toEqual([
      "互联网的核心部分",
      "1.3.2 协议与划分层次",
    ]);
    expect(question.difficulty).toBe(2);
    expect(question.analysis).toBe("分组交换是 ARPANET 的核心技术。");
  });

  it("字符串形式的知识点名称按中文标点拆分并去重", () => {
    expect(parseJsonKnowledgePointNames("第一章 概述、协议；协议")).toEqual([
      "第一章 概述",
      "协议",
    ]);
    expect(parseJsonKnowledgePointNames(["甲", "乙", "丙", "丁"])).toEqual([
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
    expect(parseJsonKnowledgePointNames(undefined)).toEqual([]);
    expect(parseJsonKnowledgePointNames([{ name: "对象" }, 3])).toEqual(["3"]);
  });
});

describe("allImportableDraftsHaveKnowledge · 是否跳过后台知识点匹配", () => {
  const withKp = makeDraft({
    draft_id: "with-kp",
    review_status: "approved",
    suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
  });
  const withoutKp = makeDraft({
    draft_id: "without-kp",
    review_status: "approved",
    suggested_knowledge_points: [],
  });

  it("待导入题目都已关联知识点时返回 true", () => {
    expect(allImportableDraftsHaveKnowledge([withKp])).toBe(true);
  });

  it("有一道没关联知识点就返回 false，仍要排后台匹配", () => {
    expect(allImportableDraftsHaveKnowledge([withKp, withoutKp])).toBe(false);
  });

  it("忽略不参与导入的草稿（跳过 / 有阻塞问题）", () => {
    const skipped = makeDraft({
      draft_id: "skipped",
      review_status: "skipped",
      suggested_knowledge_points: [],
    });
    const blocked = makeDraft({
      draft_id: "blocked",
      review_status: "approved",
      issues: ["选择题选项不完整"],
      suggested_knowledge_points: [],
    });
    expect(allImportableDraftsHaveKnowledge([withKp, skipped, blocked])).toBe(true);
  });

  it("没有可导入题目时返回 false", () => {
    expect(allImportableDraftsHaveKnowledge([])).toBe(false);
  });
});

describe("applyZipImageUrls · ZIP 图片回填", () => {
  const uploads = [
    {
      image_id: "zip-img-a-png",
      url: "https://cdn.example.com/u/a.png",
      order: 1,
      alt: "a.png",
    },
  ];

  it("把 content_html 里指向 ZIP 的 <img src> 换成上传后的地址", () => {
    const draft = makeDraft({
      draft_id: "json-1",
      content_html:
        '<p>题干</p><p><img src="/api/uploads/files/a.png" alt="原卷配图"></p>',
      images: [
        {
          image_id: "json-img-a-png-0",
          url: "/api/uploads/files/a.png",
          order: 1,
          alt: "原卷配图",
        },
      ],
    });

    const result = applyZipImageUrls([draft], uploads);

    expect(result.drafts[0].content_html).toContain(
      'src="https://cdn.example.com/u/a.png"',
    );
    expect(result.drafts[0].images?.[0].url).toBe("https://cdn.example.com/u/a.png");
    expect(result.missing).toEqual([]);
    expect(result.resolvedNames.has("a.png")).toBe(true);
  });

  it("ZIP 里没有这张图时保留原地址并报缺失", () => {
    const draft = makeDraft({
      draft_id: "json-2",
      content_html: '<p><img src="images/b.png" alt="原卷配图"></p>',
      images: [
        { image_id: "json-img-b-png-0", url: "images/b.png", order: 1, alt: "原卷配图" },
      ],
    });

    const result = applyZipImageUrls([draft], uploads);

    expect(result.drafts[0].content_html).toContain('src="images/b.png"');
    expect(result.missing).toEqual(["b.png"]);
  });

  it("没有上传任何图片时原样返回，不误报缺失", () => {
    const draft = makeDraft({
      draft_id: "json-3",
      content_html: '<p><img src="/api/uploads/files/c.png" alt="图"></p>',
    });

    const result = applyZipImageUrls([draft], []);

    expect(result.drafts[0]).toBe(draft);
    expect(result.missing).toEqual([]);
  });

  it("同时替换 answer_html 里的图片", () => {
    const draft = makeDraft({
      draft_id: "json-4",
      answer_html: '<p><img src="images/a.png" alt="答案图"></p>',
    });

    const result = applyZipImageUrls([draft], uploads);

    expect(result.drafts[0].answer_html).toContain(
      'src="https://cdn.example.com/u/a.png"',
    );
  });
});

describe("extractQuestionImportPayload · ZIP（JSON + images 相对路径）", () => {
  it("按 content.images / 题干 html 里的文件名从 ZIP 取图上传", async () => {
    const zip = new JSZip();
    zip.file(
      "questions.json",
      JSON.stringify({
        questions: [
          {
            type: "essay",
            content: {
              text: "有一小型校园网的网络结构如图。",
              html:
                '<p>有一小型校园网的网络结构如图。</p><p style="margin:12px 0"><img src="/api/uploads/files/topo.png" alt="原卷配图"></p>',
              images: [
                {
                  image_id: "topo",
                  url: "/api/uploads/files/topo.png",
                  order: 0,
                  page: 3,
                  alt: "原卷配图",
                },
              ],
            },
            answer: { points: ["略"] },
          },
        ],
      }),
    );
    zip.file("images/topo.png", new Uint8Array([137, 80, 78, 71]));
    const zipFile = new File([await zip.generateAsync({ type: "blob" })], "第4章.zip", {
      type: "application/zip",
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/u/topo.png" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const payload = await extractQuestionImportPayload(zipFile);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(payload.images).toHaveLength(1);
      expect(payload.images[0].alt).toBe("topo.png");
      expect(payload.images[0].url).toBe("https://cdn.example.com/u/topo.png");

      const parsed = parseJsonQuestions(payload.rawText);
      const resolved = applyZipImageUrls(parsed.drafts, payload.images);
      expect(resolved.drafts[0].content_html).toContain(
        'src="https://cdn.example.com/u/topo.png"',
      );
      expect(resolved.missing).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ZIP 里缺图时不中断导入，草稿保留原地址并被标记缺失", async () => {
    const zip = new JSZip();
    zip.file(
      "questions.json",
      JSON.stringify([
        {
          type: "short_answer",
          content: {
            text: "如图所示。",
            html: '<p>如图所示。</p><img src="images/missing.png" alt="原卷配图">',
          },
          answer: { points: ["略"] },
        },
      ]),
    );
    const zipFile = new File([await zip.generateAsync({ type: "blob" })], "q.zip", {
      type: "application/zip",
    });

    vi.stubGlobal("fetch", vi.fn());
    try {
      const payload = await extractQuestionImportPayload(zipFile);
      expect(payload.images).toEqual([]);

      const parsed = parseJsonQuestions(payload.rawText);
      const resolved = applyZipImageUrls(parsed.drafts, payload.images);
      expect(resolved.missing).toEqual([]); // 没上传任何图片时不做缺失判定
      expect(resolved.drafts[0].content_html).toContain('src="images/missing.png"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("parseJsonQuestions · 表格", () => {
  it("content.tables 的二维数组渲染成 <table> 并拼进题干 html", () => {
    const { drafts } = parseJsonQuestions(
      JSON.stringify([
        {
          type: "short_answer",
          content: {
            text: "路由器 B 的路由表如下",
            tables: [[["目的网络", "距离"], ["N1", "7"], ["N2", "2"]]],
          },
          answer: { points: ["略"] },
        },
      ]),
    );

    const html = drafts[0].content_html ?? "";
    expect(html).toContain("<table");
    expect(html).toContain("目的网络");
    expect(html).toContain("N1");
    expect(html).toContain("路由器 B 的路由表如下");
  });

  it("支持 {rows: [...]} 形状，且 table 单元格走 HTML 转义", () => {
    const { drafts } = parseJsonQuestions(
      JSON.stringify([
        {
          type: "short_answer",
          content: { text: "见下表", tables: [{ rows: [["A<B"], ["1&2"]] }] },
          answer: { points: ["略"] },
        },
      ]),
    );

    const html = drafts[0].content_html ?? "";
    expect(html).toContain("<table");
    expect(html).toContain("A&lt;B");
    expect(html).toContain("1&amp;2");
  });

  it("题干 html 里已有 <table> 时不再重复追加", () => {
    const { drafts } = parseJsonQuestions(
      JSON.stringify([
        {
          type: "short_answer",
          content: {
            text: "见下表",
            html: "<p>见下表</p><table><tr><td>已有</td></tr></table>",
            tables: [[["重复"]]],
          },
          answer: { points: ["略"] },
        },
      ]),
    );

    const html = drafts[0].content_html ?? "";
    expect(html.match(/<table/g)?.length).toBe(1);
    expect(html).not.toContain("重复");
  });
});
