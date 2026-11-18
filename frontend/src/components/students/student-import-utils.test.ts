import { describe, expect, it, vi } from "vitest";

import {
  buildStudentBatchImportItems,
  parseStudentImportFile,
  prepareStudentImportClasses,
} from "./student-import-utils";

async function workbookFileFromRows(rows: unknown[][]): Promise<File> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "sheet1");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    name: "点名册.xlsx",
    arrayBuffer: async () => buffer,
  } as File;
}

describe("student import utils", () => {
  it("parses school roster files with student id, name, and class when phone is absent", async () => {
    const file = await workbookFileFromRows([
      ["教师工作手册"],
      [],
      ["2025-2026学年第2学期"],
      ["课程号：", "823105113", "课序号：", "01", "课程名：", "数据库应用(SQL)"],
      ["学分：", "4", "学时：", "68"],
      ["序号", "学号", "姓名", "班级", "修读方式", "重修重考"],
      [],
      ["1", "3256260101", "许宇航", "2025级健康大数据班", "正常", "初修"],
      ["2", "3256260102", "吴沫茹", "2025级健康大数据班", "正常", "初修"],
    ]);

    await expect(parseStudentImportFile(file)).resolves.toEqual([
      {
        full_name: "许宇航",
        phone: "",
        student_id: "3256260101",
        class_name: "2025级健康大数据班",
      },
      {
        full_name: "吴沫茹",
        phone: "",
        student_id: "3256260102",
        class_name: "2025级健康大数据班",
      },
    ]);
  });

  it("uses roster class names before selected fallback class and reuses existing classes", async () => {
    const createClass = vi.fn(async (name: string) => ({ id: `created-${name}`, name }));

    const result = await buildStudentBatchImportItems({
      rows: [
        { full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" },
        { full_name: "张三", phone: "13800000001", student_id: "S002", class_name: "新班级" },
        { full_name: "李四", phone: "13800000002", student_id: "S003", class_name: "" },
      ],
      classes: [{ id: "class-existing", name: "2025级健康大数据班" }],
      fallbackClassId: "fallback-class",
      createClass,
    });

    expect(createClass).toHaveBeenCalledOnce();
    expect(createClass).toHaveBeenCalledWith("新班级");
    expect(result.students).toEqual([
      { full_name: "许宇航", phone: null, student_id: "3256260101", class_id: "class-existing" },
      { full_name: "张三", phone: "13800000001", student_id: "S002", class_id: "created-新班级" },
      { full_name: "李四", phone: "13800000002", student_id: "S003", class_id: "fallback-class" },
    ]);
  });

  it("matches a visible class when the roster name only differs by whitespace", async () => {
    const createClass = vi.fn(async (name: string) => ({ id: `created-${name}`, name }));

    const result = await buildStudentBatchImportItems({
      rows: [
        { full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级  健康大数据班" },
      ],
      classes: [{ id: "class-existing", name: "2025级 健康大数据班" }],
      createClass,
    });

    expect(createClass).not.toHaveBeenCalled();
    expect(result.students[0].class_id).toBe("class-existing");
  });

  it("asks before reusing a same-school class that is outside the teacher's class list", async () => {
    const lookup = vi.fn(async () => [
      {
        name: "2025级健康大数据班",
        matches: [
          { id: "class-38", name: "2025级健康大数据班", member_count: 38, created_by_name: "yu_qiqiong" },
        ],
      },
    ]);
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    const classes = await prepareStudentImportClasses({
      rows: [
        { full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" },
        { full_name: "吴沫茹", phone: "", student_id: "3256260102", class_name: "2025级健康大数据班" },
      ],
      classes: [],
      lookup,
      confirm,
    });

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(["2025级健康大数据班"]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain("同校已存在同名班级");
    expect(confirm.mock.calls[0][0]).toContain("38 人");
    expect(classes).toEqual([{ id: "class-38", name: "2025级健康大数据班" }]);
  });

  it("skips the lookup when the class is already visible", async () => {
    const lookup = vi.fn(async () => []);
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    const classes = [{ id: "class-visible", name: "2025级健康大数据班" }];

    const result = await prepareStudentImportClasses({
      rows: [{ full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" }],
      classes,
      lookup,
      confirm,
    });

    expect(lookup).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(result).toBe(classes);
  });

  it("resolves duplicate visible classes to the most populated same-school class", async () => {
    const lookup = vi.fn(async () => [
      {
        name: "2025级健康大数据班",
        matches: [
          { id: "class-empty", name: "2025级健康大数据班", member_count: 0 },
          { id: "class-38", name: "2025级健康大数据班", member_count: 38 },
        ],
      },
    ]);

    const classes = await prepareStudentImportClasses({
      rows: [{ full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" }],
      classes: [
        { id: "class-38", name: "2025级健康大数据班" },
        { id: "class-empty", name: "2025级健康大数据班" },
      ],
      lookup,
      confirm: () => true,
    });

    expect(lookup).toHaveBeenCalledOnce();
    // The stale duplicate is dropped and the chosen class is appended last so
    // buildStudentBatchImportItems' name map keeps pointing at it.
    expect(classes).toEqual([{ id: "class-38", name: "2025级健康大数据班" }]);
  });

  it("aborts the import when the teacher declines the same-school class", async () => {
    const lookup = vi.fn(async () => [
      {
        name: "2025级健康大数据班",
        matches: [{ id: "class-38", name: "2025级健康大数据班", member_count: 38 }],
      },
    ]);

    await expect(
      prepareStudentImportClasses({
        rows: [{ full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" }],
        classes: [],
        lookup,
        confirm: () => false,
      }),
    ).rejects.toThrow("已取消导入");
  });

  it("uses the most populated class when legacy duplicates share a name", async () => {
    const lookup = vi.fn(async () => [
      {
        name: "2025级健康大数据班",
        matches: [
          { id: "class-empty", name: "2025级健康大数据班", member_count: 0 },
          { id: "class-38", name: "2025级健康大数据班", member_count: 38 },
        ],
      },
    ]);

    const classes = await prepareStudentImportClasses({
      rows: [{ full_name: "许宇航", phone: "", student_id: "3256260101", class_name: "2025级健康大数据班" }],
      classes: [],
      lookup,
      confirm: () => true,
    });

    expect(classes).toEqual([{ id: "class-38", name: "2025级健康大数据班" }]);
  });
});
