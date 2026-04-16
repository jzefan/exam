import { describe, expect, it } from "vitest";

import {
  getReadOnlyDirectionFeedback,
  getReadOnlyKnowledgeFeedback,
  getReadOnlyMajorFeedback,
} from "./access-messages";

describe("knowledge access messages", () => {
  it("returns root knowledge readonly message", () => {
    expect(
      getReadOnlyKnowledgeFeedback({
        id: "kp-1",
        name: "公开主知识",
        description: null,
        tags: [],
        difficulty: null,
        parent_id: null,
        direction_id: "dir-1",
        owner_id: "owner-1",
        visibility: "platform",
        question_count: 0,
      }),
    ).toContain("公共主知识/技能");
  });

  it("returns child knowledge readonly message", () => {
    expect(
      getReadOnlyKnowledgeFeedback({
        id: "kp-2",
        name: "公开子知识",
        description: null,
        tags: [],
        difficulty: null,
        parent_id: "kp-1",
        direction_id: "dir-1",
        owner_id: "owner-1",
        visibility: "platform",
        question_count: 0,
      }),
    ).toContain("公共知识点");
  });

  it("returns readonly messages for public major and direction", () => {
    expect(getReadOnlyMajorFeedback()).toContain("公共专业");
    expect(getReadOnlyDirectionFeedback()).toContain("公共方向");
  });
});
