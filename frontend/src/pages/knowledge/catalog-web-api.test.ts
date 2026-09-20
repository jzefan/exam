import { describe, expect, it } from "vitest";

import {
  editableTextToPaths,
  extractErrorMessage,
  formatPublishYear,
  pathsToEditableText,
} from "./catalog-web-api";

describe("pathsToEditableText / editableTextToPaths", () => {
  it("round-trips a catalog tree", () => {
    const paths = [
      ["第一章 概述", "1.1 计算机网络在信息时代的作用"],
      ["第一章 概述", "1.2 互联网概述"],
      ["第二章 物理层"],
    ];

    const text = pathsToEditableText(paths);

    expect(text).toBe(
      "第一章 概述 > 1.1 计算机网络在信息时代的作用\n" +
        "第一章 概述 > 1.2 互联网概述\n" +
        "第二章 物理层",
    );
    expect(editableTextToPaths(text)).toEqual(paths);
  });

  it("accepts full-width and arrow separators", () => {
    expect(editableTextToPaths("第一章 概述 ＞ 1.1 互联网概述\n第二章 物理层 → 2.1 基本概念")).toEqual([
      ["第一章 概述", "1.1 互联网概述"],
      ["第二章 物理层", "2.1 基本概念"],
    ]);
  });

  it("drops blank lines and duplicate paths", () => {
    expect(editableTextToPaths("\n第一章 概述\n\n第一章 概述\n   \n第二章 物理层")).toEqual([
      ["第一章 概述"],
      ["第二章 物理层"],
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(editableTextToPaths("")).toEqual([]);
    expect(editableTextToPaths("   \n  \n")).toEqual([]);
  });

  it("trims segment whitespace", () => {
    expect(editableTextToPaths("  第一章 概述   >   1.1 互联网概述  ")).toEqual([
      ["第一章 概述", "1.1 互联网概述"],
    ]);
  });
});

describe("formatPublishYear", () => {
  it("keeps only the year of a publish date", () => {
    expect(formatPublishYear("2017-01-01")).toBe("2017");
    expect(formatPublishYear("2021/06")).toBe("2021");
  });

  it("returns an empty string when there is no year", () => {
    expect(formatPublishYear("")).toBe("");
    expect(formatPublishYear("出版日期不详")).toBe("");
  });
});

describe("extractErrorMessage", () => {
  it("unwraps a FastAPI detail payload", () => {
    expect(extractErrorMessage(new Error('{"detail":"没能获取到这本书的目录。"}'), "兜底")).toBe(
      "没能获取到这本书的目录。",
    );
  });

  it("keeps a plain message as-is", () => {
    expect(extractErrorMessage(new Error("网络错误"), "兜底")).toBe("网络错误");
  });

  it("falls back when the error carries no message", () => {
    expect(extractErrorMessage(new Error("   "), "兜底文案")).toBe("兜底文案");
    expect(extractErrorMessage(null, "兜底文案")).toBe("兜底文案");
  });
});
