import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MajorDirectionSidebar } from "./MajorDirectionSidebar";
import type { IDirection, IKnowledgePointDetail, IMajor } from "./types";

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

describe("MajorDirectionSidebar", () => {
  it("shows inline add actions for expanded levels and a persistent add major button", () => {
    render(
      <MajorDirectionSidebar
        majors={majors}
        selectedDirectionId="direction-1"
        selectedRootKnowledgeId={null}
        onSelect={vi.fn()}
        onSelectRootKnowledge={vi.fn()}
        getDirections={() => directions}
        getRootKnowledgePoints={() => rootKnowledgePoints}
        onCreateMajor={vi.fn()}
        onEditMajor={vi.fn()}
        onDeleteMajor={vi.fn()}
        onCreateDirection={vi.fn()}
        onCreateRootKnowledge={vi.fn()}
        onEditDirection={vi.fn()}
        onDeleteDirection={vi.fn()}
        onEditRootKnowledge={vi.fn()}
        onDeleteRootKnowledge={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "添加专业" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加主知识/技能" })).toBeInTheDocument();
  });

  it("expands only the first major by default", () => {
    render(
      <MajorDirectionSidebar
        majors={majors}
        selectedDirectionId={null}
        selectedRootKnowledgeId={null}
        onSelect={vi.fn()}
        onSelectRootKnowledge={vi.fn()}
        getDirections={(majorId) => directions.filter((direction) => direction.major_id === majorId)}
        getRootKnowledgePoints={() => []}
        onCreateMajor={vi.fn()}
        onEditMajor={vi.fn()}
        onDeleteMajor={vi.fn()}
        onCreateDirection={vi.fn()}
        onCreateRootKnowledge={vi.fn()}
        onEditDirection={vi.fn()}
        onDeleteDirection={vi.fn()}
        onEditRootKnowledge={vi.fn()}
        onDeleteRootKnowledge={vi.fn()}
      />,
    );

    expect(screen.getByText("软件开发")).toBeInTheDocument();
    expect(screen.queryByText("机器学习")).not.toBeInTheDocument();
  });

  it("keeps only the clicked major expanded", () => {
    render(
      <MajorDirectionSidebar
        majors={majors}
        selectedDirectionId={null}
        selectedRootKnowledgeId={null}
        onSelect={vi.fn()}
        onSelectRootKnowledge={vi.fn()}
        getDirections={(majorId) => directions.filter((direction) => direction.major_id === majorId)}
        getRootKnowledgePoints={() => []}
        onCreateMajor={vi.fn()}
        onEditMajor={vi.fn()}
        onDeleteMajor={vi.fn()}
        onCreateDirection={vi.fn()}
        onCreateRootKnowledge={vi.fn()}
        onEditDirection={vi.fn()}
        onDeleteDirection={vi.fn()}
        onEditRootKnowledge={vi.fn()}
        onDeleteRootKnowledge={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "人工智能" }));

    expect(screen.queryByText("软件开发")).not.toBeInTheDocument();
    expect(screen.getByText("机器学习")).toBeInTheDocument();
  });
});
