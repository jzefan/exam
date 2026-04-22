import { describe, expect, it, vi } from "vitest";

import { buildStudentBatchImportItems, parseStudentImportFile } from "./student-import-utils";

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
});
