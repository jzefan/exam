import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { RelatedResourcesDialog } from "./RelatedResourcesDialog";

const relatedQuestions: IQuestion[] = [
  {
    id: "question-1",
    type: "short_answer",
    title: "默认标题",
    content: { text: "请解释索引覆盖为什么可以减少回表。" },
    options: null,
    answer: { points: ["减少随机 IO", "直接命中辅助索引"] },
    analysis: "覆盖索引让查询直接在索引层完成。",
    difficulty: 4,
    score: 10,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "数据库",
    tags: [],
    knowledge_points: [],
    created_by: "user-1",
    created_by_name: "Teacher",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
];

describe("RelatedResourcesDialog", () => {
  it("renders related question cards inside the questions tab", () => {
    render(
      <RelatedResourcesDialog
        open
        node={{
          id: "kp-1",
          name: "数据库索引",
          description: "索引原理",
          tags: [],
          difficulty: "中级",
          parent_id: null,
          direction_id: "dir-1",
          question_count: 1,
        }}
        major={null}
        direction={null}
        materials={[]}
        relatedQuestions={relatedQuestions}
        relatedQuestionsLoading={false}
        onAddMaterial={vi.fn()}
        onDeleteMaterial={vi.fn()}
        onClose={vi.fn()}
        onViewQuestions={vi.fn()}
        onGenerateRecommendations={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(screen.getByText("请解释索引覆盖为什么可以减少回表。")).toBeInTheDocument();
    expect(screen.getByText(/答案要点：减少随机 IO；直接命中辅助索引/)).toBeInTheDocument();
  });
});
