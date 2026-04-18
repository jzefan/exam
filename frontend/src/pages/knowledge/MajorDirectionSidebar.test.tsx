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
];

const directions: IDirection[] = [
  {
    id: "direction-1",
    major_id: "major-1",
    name: "软件开发",
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

  it("reveals the inline add direction action after expanding a collapsed major", () => {
    render(
      <MajorDirectionSidebar
        majors={majors}
        selectedDirectionId={null}
        selectedRootKnowledgeId={null}
        onSelect={vi.fn()}
        onSelectRootKnowledge={vi.fn()}
        getDirections={() => directions}
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

    fireEvent.click(screen.getByRole("button", { name: "软件工程" }));

    expect(screen.queryByRole("button", { name: "添加方向" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "软件工程" }));

    expect(screen.getByRole("button", { name: "添加方向" })).toBeInTheDocument();
  });
});
