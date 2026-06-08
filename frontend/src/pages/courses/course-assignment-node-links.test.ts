import { describe, expect, it } from "vitest";

import {
  buildAssignmentLinksByNodeId,
  filterAssignmentsForKnowledgeNode,
  type AssignmentLinkable,
  type KnowledgeNodeLinkable,
} from "./course-assignment-node-links";

const tree: KnowledgeNodeLinkable = {
  id: "course",
  name: "Python程序设计",
  children: [
    {
      id: "chapter-1",
      name: "第1章 Python数据概述",
      children: [
        { id: "section-1-1", name: "1.1 程序设计语言", children: [] },
        { id: "section-1-2", name: "1.2 Python语言概述", children: [] },
      ],
    },
    { id: "chapter-2", name: "第2章 Python语言基础", children: [] },
  ],
};

const assignments: AssignmentLinkable[] = [
  {
    id: "assignment-a",
    title: "1.1 课后练习",
    course_kp_id: null,
    knowledge_points: [{ id: "section-1-1", name: "1.1 程序设计语言" }],
  },
  {
    id: "assignment-b",
    title: "第2章练习",
    course_kp_id: "chapter-2",
    knowledge_points: [],
  },
  {
    id: "assignment-c",
    title: "全课导学",
    course_kp_id: "course",
    knowledge_points: [],
  },
];

describe("course assignment node links", () => {
  it("rolls assignment badges up from child knowledge points", () => {
    const links = buildAssignmentLinksByNodeId(tree, assignments);

    expect(links["section-1-1"]?.map((item) => item.id)).toEqual([
      "assignment-a",
    ]);
    expect(links["chapter-1"]?.map((item) => item.id)).toEqual([
      "assignment-a",
    ]);
    expect(links["course"]?.map((item) => item.id)).toEqual([
      "assignment-a",
      "assignment-b",
      "assignment-c",
    ]);
  });

  it("uses explicit course_kp_id when an assignment is created from a chapter", () => {
    const related = filterAssignmentsForKnowledgeNode(
      tree,
      assignments,
      "chapter-2",
    );

    expect(related.map((item) => item.id)).toEqual(["assignment-b"]);
  });
});
