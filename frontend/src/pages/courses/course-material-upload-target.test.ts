import { describe, expect, it } from "vitest";

import {
  flattenKnowledgeUploadTargets,
  resolveDefaultKnowledgeUploadTargetId,
  type CourseKnowledgeUploadNode,
} from "./course-material-upload-target";

describe("course material upload target helpers", () => {
  const tree: CourseKnowledgeUploadNode = {
    id: "course-root",
    name: "数据结构",
    children: [
      {
        id: "chapter-1",
        name: "第一章 绪论",
        children: [
          {
            id: "section-1",
            name: "算法复杂度",
            children: [],
          },
        ],
      },
    ],
  };

  it("lists the course root first and keeps child knowledge paths", () => {
    expect(flattenKnowledgeUploadTargets(tree)).toEqual([
      {
        id: "course-root",
        name: "数据结构",
        depth: 0,
        path: "数据结构",
      },
      {
        id: "chapter-1",
        name: "第一章 绪论",
        depth: 1,
        path: "数据结构 / 第一章 绪论",
      },
      {
        id: "section-1",
        name: "算法复杂度",
        depth: 2,
        path: "数据结构 / 第一章 绪论 / 算法复杂度",
      },
    ]);
  });

  it("defaults uploads to the course root when only the course node exists", () => {
    expect(
      resolveDefaultKnowledgeUploadTargetId({
        id: "course-root",
        name: "数据结构",
        children: [],
      }),
    ).toBe("course-root");
  });

  it("still defaults uploads to the course root when child nodes exist", () => {
    expect(resolveDefaultKnowledgeUploadTargetId(tree)).toBe("course-root");
  });
});
