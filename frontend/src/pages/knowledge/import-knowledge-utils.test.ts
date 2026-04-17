import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { extractKnowledgeImportPaths, summarizeKnowledgeImportPaths } from "./import-knowledge-utils";

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
});
