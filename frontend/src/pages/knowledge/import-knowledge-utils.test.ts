import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import {
  buildKnowledgeImportPreviewTree,
  extractKnowledgeImportPaths,
  getFirstKnowledgeImportRootName,
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
