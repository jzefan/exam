import { describe, expect, it } from "vitest";

import { getExamDeleteDescription, getQuestionDeleteDescription } from "./deletion-copy";

describe("deletion copy helpers", () => {
  it("explains question deletion as recycle-first behavior", () => {
    expect(getQuestionDeleteDescription()).toContain("进入回收状态");
    expect(getQuestionDeleteDescription()).toContain("不会立即彻底删除");
  });

  it("explains submitted exams are archived instead of purged", () => {
    expect(getExamDeleteDescription("考试", "期中考试")).toContain("若尚无学生作答记录，将被彻底删除");
    expect(getExamDeleteDescription("考试", "期中考试")).toContain("若已有考生提交，将仅归档隐藏并保留答卷历史");
  });
});
