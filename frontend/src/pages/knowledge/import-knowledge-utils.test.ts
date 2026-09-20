import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import {
  DRAFT_ROOT_DEPTH,
  addKnowledgeDraftChildren,
  buildKnowledgeDraftTree,
  buildKnowledgeImportPreviewTree,
  countKnowledgeDraftNodes,
  dedupeKnowledgeImportPaths,
  draftNodeKey,
  extractKnowledgeImportPaths,
  findKnowledgeDraftNode,
  getFirstKnowledgeImportRootName,
  removeKnowledgeDraftNode,
  renameKnowledgeDraftNode,
  summarizeKnowledgeImportPaths,
} from "./import-knowledge-utils";

function buildExcelFile(rows: string[][], name = "knowledge.xlsx") {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet(rows);
  utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = write(workbook, { type: "array", bookType: "xlsx" });
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("knowledge import utils", () => {
  it("extracts multi-column knowledge paths and skips header rows", async () => {
    const file = buildExcelFile([
      ["一级知识点", "二级知识点", "三级知识点"],
      ["数据库基础", "关系模型", "候选键"],
      ["数据库基础", "关系模型", "外键"],
      ["数据库基础", "SQL", ""],
    ]);

    const paths = await extractKnowledgeImportPaths(file);

    expect(paths).toEqual([
      ["数据库基础", "关系模型", "候选键"],
      ["数据库基础", "关系模型", "外键"],
      ["数据库基础", "SQL"],
    ]);
  });

  it("supports single-cell outline paths split by arrows", async () => {
    const file = buildExcelFile([
      ["目录"],
      ["第1章 数据库系统概述 > 1.1 数据模型 > 1.1.1 关系模型"],
      ["第1章 数据库系统概述 > 1.2 数据独立性"],
    ]);

    const paths = await extractKnowledgeImportPaths(file);

    expect(paths).toEqual([
      ["第1章 数据库系统概述", "1.1 数据模型", "1.1.1 关系模型"],
      ["第1章 数据库系统概述", "1.2 数据独立性"],
    ]);
  });

  it("summarizes imported paths for preview", () => {
    expect(
      summarizeKnowledgeImportPaths([
        ["数据库基础", "关系模型", "候选键"],
        ["数据库基础", "SQL"],
        ["事务管理"],
      ]),
    ).toEqual({
      totalPaths: 3,
      maxDepth: 3,
      rootCount: 2,
    });
  });

  it("returns the first top-level knowledge name for post-import focus", () => {
    expect(
      getFirstKnowledgeImportRootName([
        ["数据库基础", "关系模型", "候选键"],
        ["事务管理"],
      ]),
    ).toBe("数据库基础");

    expect(getFirstKnowledgeImportRootName([[], ["", "关系模型"]])).toBeNull();
  });

  it("builds a merged tree for graphical preview", () => {
    expect(
      buildKnowledgeImportPreviewTree([
        ["数据库基础", "关系模型", "候选键"],
        ["数据库基础", "关系模型", "外键"],
        ["数据库基础", "SQL"],
        ["事务管理"],
      ]),
    ).toEqual([
      {
        label: "数据库基础",
        depth: 0,
        pathIndexes: [0, 1, 2],
        children: [
          {
            label: "关系模型",
            depth: 1,
            pathIndexes: [0, 1],
            children: [
              { label: "候选键", depth: 2, pathIndexes: [0], children: [] },
              { label: "外键", depth: 2, pathIndexes: [1], children: [] },
            ],
          },
          {
            label: "SQL",
            depth: 1,
            pathIndexes: [2],
            children: [],
          },
        ],
      },
      {
        label: "事务管理",
        depth: 0,
        pathIndexes: [3],
        children: [],
      },
    ]);
  });
});

// 草稿目录编辑器（第 3 步「编辑目录」）使用的纯函数：操作还没落库的草稿路径。
describe("knowledge draft editor utils", () => {
  const PATHS = [
    ["第一章 概述", "1.1 互联网概述"],
    ["第一章 概述", "1.2 互联网的组成"],
    ["第二章 物理层"],
  ];

  it("builds a draft tree rooted at the course node", () => {
    const tree = buildKnowledgeDraftTree("计算机网络", PATHS);

    expect(tree.label).toBe("计算机网络");
    expect(tree.depth).toBe(DRAFT_ROOT_DEPTH);
    expect(tree.prefix).toEqual([]);
    expect(tree.children.map((child) => child.label)).toEqual(["第一章 概述", "第二章 物理层"]);
    expect(tree.children[0].prefix).toEqual(["第一章 概述"]);
    expect(tree.children[0].children.map((child) => child.label)).toEqual([
      "1.1 互联网概述",
      "1.2 互联网的组成",
    ]);
    expect(tree.children[0].children[1].prefix).toEqual(["第一章 概述", "1.2 互联网的组成"]);
    // 2 个章 + 2 个节。
    expect(countKnowledgeDraftNodes(tree)).toBe(4);
  });

  it("locates nodes by key, including the virtual root", () => {
    const tree = buildKnowledgeDraftTree("计算机网络", PATHS);

    expect(draftNodeKey(tree)).toBe("");
    expect(findKnowledgeDraftNode(tree, "")?.label).toBe("计算机网络");
    expect(findKnowledgeDraftNode(tree, "第一章 概述")?.label).toBe("第一章 概述");
    expect(
      findKnowledgeDraftNode(tree, draftNodeKey(tree.children[0].children[0]))?.label,
    ).toBe("1.1 互联网概述");
    expect(findKnowledgeDraftNode(tree, "不存在的节点")).toBeNull();
  });

  it("renames a node across every path passing through it", () => {
    expect(renameKnowledgeDraftNode(PATHS, ["第一章 概述"], "第一章 计算机网络概述")).toEqual([
      ["第一章 计算机网络概述", "1.1 互联网概述"],
      ["第一章 计算机网络概述", "1.2 互联网的组成"],
      ["第二章 物理层"],
    ]);
  });

  it("renames a leaf without touching its siblings", () => {
    const renamed = renameKnowledgeDraftNode(
      PATHS,
      ["第一章 概述", "1.1 互联网概述"],
      "1.1 互联网概述（修订）",
    );

    expect(renamed).toEqual([
      ["第一章 概述", "1.1 互联网概述（修订）"],
      ["第一章 概述", "1.2 互联网的组成"],
      ["第二章 物理层"],
    ]);
  });

  it("adds children under the selected node, and at the top level for the root", () => {
    expect(addKnowledgeDraftChildren(PATHS, ["第二章 物理层"], ["2.1 基本概念"])).toEqual([
      ...PATHS,
      ["第二章 物理层", "2.1 基本概念"],
    ]);
    expect(addKnowledgeDraftChildren(PATHS, [], ["第三章 数据链路层"])).toEqual([
      ...PATHS,
      ["第三章 数据链路层"],
    ]);
  });

  it("does not add a child twice", () => {
    const once = addKnowledgeDraftChildren(PATHS, ["第二章 物理层"], ["2.1 基本概念"]);
    expect(addKnowledgeDraftChildren(once, ["第二章 物理层"], ["2.1 基本概念"])).toEqual(once);
  });

  it("removes a node together with its subtree", () => {
    expect(removeKnowledgeDraftNode(PATHS, ["第一章 概述"])).toEqual([["第二章 物理层"]]);
    expect(removeKnowledgeDraftNode(PATHS, ["第一章 概述", "1.1 互联网概述"])).toEqual([
      ["第一章 概述", "1.2 互联网的组成"],
      ["第二章 物理层"],
    ]);
  });

  it("refuses to remove or rename with an empty target", () => {
    expect(removeKnowledgeDraftNode(PATHS, [])).toEqual(PATHS);
    expect(renameKnowledgeDraftNode(PATHS, [], "新名字")).toEqual(PATHS);
    expect(renameKnowledgeDraftNode(PATHS, ["第二章 物理层"], "   ")).toEqual(PATHS);
  });

  it("drops blank and duplicate paths", () => {
    expect(
      dedupeKnowledgeImportPaths([
        ["第一章 概述", " 1.1 互联网概述 "],
        ["第一章 概述", "1.1 互联网概述"],
        [],
      ]),
    ).toEqual([["第一章 概述", "1.1 互联网概述"]]);
  });
});
