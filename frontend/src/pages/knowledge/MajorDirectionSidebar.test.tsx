import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { MajorDirectionSidebar } from "./MajorDirectionSidebar";
import type { IDirection, IKnowledgePointDetail, IMajor, IRootKnowledgePointOption } from "./types";

const majors: IMajor[] = [
  {
    id: "major-1",
    name: "软件工程",
    description: null,
    created_at: "2026-04-18T00:00:00Z",
  },
  {
    id: "major-2",
    name: "人工智能",
    description: null,
    created_at: "2026-04-18T00:00:00Z",
  },
];

const directions: IDirection[] = [
  {
    id: "direction-1",
    major_id: "major-1",
    name: "软件开发",
    description: null,
    created_at: "2026-04-18T00:00:00Z",
  },
  {
    id: "direction-2",
    major_id: "major-2",
    name: "机器学习",
    description: null,
    created_at: "2026-04-18T00:00:00Z",
  },
];

const rootKnowledgePoints: IKnowledgePointDetail[] = [
  {
    id: "knowledge-1",
    name: "软件设计",
    description: null,
    tags: [],
    difficulty: null,
    parent_id: null,
    direction_id: "direction-1",
    question_count: 0,
  },
];

const majorRootKnowledgePoints: IRootKnowledgePointOption[] = [
  {
    ...rootKnowledgePoints[0],
    direction_id: "direction-1",
    direction_name: "软件开发",
    major_id: "major-1",
    major_name: "软件工程",
  },
  {
    id: "knowledge-2",
    name: "机器学习基础",
    description: null,
    tags: [],
    difficulty: null,
    parent_id: null,
    direction_id: "direction-2",
    direction_name: "机器学习",
    major_id: "major-2",
    major_name: "人工智能",
    question_count: 0,
  },
];

function renderSidebar(
  overrides: Partial<ComponentProps<typeof MajorDirectionSidebar>> = {},
) {
  return render(
    <MajorDirectionSidebar
      majors={majors}
      selectedDirectionId={null}
      selectedRootKnowledgeId={null}
      onSelect={vi.fn()}
      onSelectRootKnowledge={vi.fn()}
      getDirections={(majorId) => directions.filter((direction) => direction.major_id === majorId)}
      getMajorRootKnowledgePoints={(majorId) =>
        majorRootKnowledgePoints.filter((knowledge) => knowledge.major_id === majorId)
      }
      getRootKnowledgePoints={(directionId) =>
        rootKnowledgePoints.filter((knowledge) => knowledge.direction_id === directionId)
      }
      onCreateMajor={vi.fn()}
      onEditMajor={vi.fn()}
      onDeleteMajor={vi.fn()}
      onCreateDirection={vi.fn()}
      onCreateRootKnowledgeInMajor={vi.fn()}
      onCreateRootKnowledge={vi.fn()}
      onEditDirection={vi.fn()}
      onDeleteDirection={vi.fn()}
      onEditRootKnowledge={vi.fn()}
      onDeleteRootKnowledge={vi.fn()}
      onMoveRootKnowledge={vi.fn()}
      onSelectMajor={vi.fn()}
      {...overrides}
    />,
  );
}

describe("MajorDirectionSidebar", () => {
  it("shows inline add actions for expanded levels and a persistent add major button", () => {
    renderSidebar({
      selectedDirectionId: "direction-1",
    });

    expect(screen.getByRole("button", { name: "添加专业" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加主知识/技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换为专业/方向/主知识" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /按方向分组/ })).not.toBeInTheDocument();
  });

  it("renders the search input", () => {
    renderSidebar();

    expect(screen.getByPlaceholderText("搜索专业、方向或知识点")).toBeInTheDocument();
  });

  it("moves a root knowledge point when dropped onto another root knowledge point", () => {
    const onMoveRootKnowledge = vi.fn();
    renderSidebar({ onMoveRootKnowledge });
    const dataTransfer = {
      effectAllowed: "",
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? "";
      },
    };

    fireEvent.dragStart(screen.getByRole("button", { name: /软件设计/ }), {
      dataTransfer,
    });
    fireEvent.click(screen.getByRole("button", { name: "人工智能" }));
    fireEvent.dragOver(screen.getByRole("button", { name: /机器学习基础/ }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: /机器学习基础/ }), {
      dataTransfer,
    });

    expect(onMoveRootKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ id: "knowledge-1" }),
      expect.objectContaining({ id: "knowledge-2" }),
    );
  });

  it("displays the system default major with a friendly name", () => {
    renderSidebar({
      majors: [
        {
          id: "major-default",
          name: "default-prof",
          description: null,
          created_at: "2026-04-18T00:00:00Z",
        },
      ],
      getDirections: () => [],
      getMajorRootKnowledgePoints: () => [],
    });

    expect(screen.getByRole("button", { name: "默认专业" })).toBeInTheDocument();
    expect(screen.queryByText("default-prof")).not.toBeInTheDocument();
  });

  it("shows major-level root knowledge by default and keeps directions collapsed", () => {
    renderSidebar();

    expect(screen.getByText("软件设计")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "软件开发" })).not.toBeInTheDocument();
    expect(screen.queryByText("机器学习")).not.toBeInTheDocument();
  });

  it("switches to direction grouping from the title row toggle", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "切换为专业/方向/主知识" }));

    expect(screen.getByText("专业 / 方向 / 主知识")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "软件开发" })).toBeInTheDocument();
    expect(screen.queryByText("软件设计")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换为专业/主知识" })).toBeInTheDocument();
  });

  it("allows expanding multiple majors independently", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "人工智能" }));

    expect(screen.getByText("软件设计")).toBeInTheDocument();
    expect(screen.getByText("机器学习基础")).toBeInTheDocument();
  });

  it("selects a major when its row is clicked even before it has root knowledge", () => {
    const onSelectMajor = vi.fn();

    renderSidebar({ onSelectMajor });

    fireEvent.click(screen.getByRole("button", { name: "人工智能" }));

    expect(onSelectMajor).toHaveBeenCalledWith(majors[1]);
  });

  it("collapses an expanded major when clicked again", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "软件工程" }));

    expect(screen.queryByText("软件设计")).not.toBeInTheDocument();
  });

  it("selects aggregated root knowledge with its original direction", () => {
    const onSelectRootKnowledge = vi.fn();

    renderSidebar({ onSelectRootKnowledge });

    fireEvent.click(screen.getByRole("button", { name: /软件设计/ }));

    expect(onSelectRootKnowledge).toHaveBeenCalledWith("direction-1", "knowledge-1");
  });

  it("filters majors by search query", () => {
    renderSidebar();

    fireEvent.change(screen.getByPlaceholderText("搜索专业、方向或知识点"), {
      target: { value: "机器" },
    });

    expect(screen.queryByRole("button", { name: "软件工程" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人工智能" })).toBeInTheDocument();
  });
});
