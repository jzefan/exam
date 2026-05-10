import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

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
  const rootKnowledge = {
    id: "root-1",
    name: "数据库系统",
    description: null,
    tags: [],
    difficulty: "中级",
    parent_id: null,
    direction_id: "dir-1",
    question_count: 3,
  };

  const childKnowledge = {
    id: "kp-1",
    name: "数据库索引",
    description: "索引原理",
    tags: [],
    difficulty: "中级",
    parent_id: "root-1",
    direction_id: "dir-1",
    question_count: 1,
  };

  it("renders related question cards inside the questions tab", async () => {
    const user = userEvent.setup();

    render(
      <RelatedResourcesDialog
        open
        node={childKnowledge}
        rootKnowledge={rootKnowledge}
        major={null}
        direction={null}
        materials={[]}
        materialsLoading={false}
        relatedQuestions={relatedQuestions}
        relatedQuestionsLoading={false}
        onAddMaterial={vi.fn()}
        onDeleteMaterial={vi.fn()}
        onGenerateQuestionsFromMaterial={vi.fn()}
        onClose={vi.fn()}
        onUploadMaterial={vi.fn()}
        onVideoSaved={vi.fn()}
        onViewQuestions={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /相关题目/ }));

    expect(screen.getByText("请解释索引覆盖为什么可以减少回表。")).toBeInTheDocument();
    expect(screen.getByText("减少随机 IO；直接命中辅助索引")).toBeInTheDocument();
  });

  it("renders as a drawer scoped to its container instead of the full viewport", () => {
    const { container } = render(
      <RelatedResourcesDialog
        open
        node={rootKnowledge}
        rootKnowledge={rootKnowledge}
        major={null}
        direction={null}
        materials={[]}
        materialsLoading={false}
        relatedQuestions={[]}
        relatedQuestionsLoading={false}
        onAddMaterial={vi.fn()}
        onDeleteMaterial={vi.fn()}
        onGenerateQuestionsFromMaterial={vi.fn()}
        onClose={vi.fn()}
        onUploadMaterial={vi.fn()}
        onVideoSaved={vi.fn()}
        onViewQuestions={vi.fn()}
      />,
    );

    const drawer = container.querySelector("aside");

    expect(drawer).toHaveClass("absolute");
    expect(drawer).toHaveClass("w-[36%]");
    expect(drawer).not.toHaveClass("fixed");
  });

  it("hides uploaded file storage paths and keeps long file names truncated", () => {
    render(
      <RelatedResourcesDialog
        open
        node={childKnowledge}
        rootKnowledge={rootKnowledge}
        major={null}
        direction={null}
        materials={[
          {
            id: "material-1",
            title: "这是一个非常非常非常非常非常非常非常非常长的上传资料文件名.docx",
            url: "/api/uploads/files/690be08be7c7453e816a61543db46b2c.docx",
            source: "upload",
            resource_type: "document",
          },
        ]}
        materialsLoading={false}
        relatedQuestions={[]}
        relatedQuestionsLoading={false}
        onAddMaterial={vi.fn()}
        onDeleteMaterial={vi.fn()}
        onGenerateQuestionsFromMaterial={vi.fn()}
        onClose={vi.fn()}
        onUploadMaterial={vi.fn()}
        onVideoSaved={vi.fn()}
        onViewQuestions={vi.fn()}
      />,
    );

    const titleButton = screen.getByRole("button", { name: /这是一个非常非常/ });

    expect(screen.queryByText(/\/api\/uploads\/files/)).not.toBeInTheDocument();
    expect(titleButton).toHaveClass("truncate");
  });

  it("shows major, direction, root knowledge and current knowledge for child nodes", () => {
    render(
      <RelatedResourcesDialog
        open
        node={childKnowledge}
        rootKnowledge={rootKnowledge}
        major={{ id: "major-1", name: "计算机科学", description: null, created_at: "2026-01-01T00:00:00Z" }}
        direction={{ id: "dir-1", major_id: "major-1", name: "网络工程", description: null, created_at: "2026-01-01T00:00:00Z" }}
        materials={[]}
        materialsLoading={false}
        relatedQuestions={[]}
        relatedQuestionsLoading={false}
        onAddMaterial={vi.fn()}
        onDeleteMaterial={vi.fn()}
        onGenerateQuestionsFromMaterial={vi.fn()}
        onClose={vi.fn()}
        onUploadMaterial={vi.fn()}
        onVideoSaved={vi.fn()}
        onViewQuestions={vi.fn()}
      />,
    );

    expect(screen.getByText("专业：计算机科学")).toBeInTheDocument();
    expect(screen.getByText("方向：网络工程")).toBeInTheDocument();
    expect(screen.getByText("主知识点：数据库系统")).toBeInTheDocument();
    expect(screen.getByText("本知识点：数据库索引")).toBeInTheDocument();
  });
});
