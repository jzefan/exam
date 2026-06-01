import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KnowledgePointSelector } from "./knowledge-point-selector";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    side,
  }: {
    children: React.ReactNode;
    side?: string;
  }) => (
    <div data-testid="kp-popover-content" data-side={side}>
      {children}
    </div>
  ),
}));

describe("KnowledgePointSelector", () => {
  it("keeps the requested popover side after pointer interaction", () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));

    render(
      <KnowledgePointSelector
        fetcher={fetcher}
        selectedKnowledgePoints={[]}
        onSelectedKnowledgePointsChange={() => {}}
        popoverSide="right"
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /选择知识点/i }), {
      pointerType: "mouse",
      clientX: 24,
      clientY: 24,
    });

    expect(screen.getByTestId("kp-popover-content")).toHaveAttribute("data-side", "right");
  });

  it("can be limited to single root knowledge point selection", async () => {
    const onChange = vi.fn();
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path === "/knowledge/majors") {
        return Promise.resolve([{ id: "major-1", name: "计算机科学与技术" }]);
      }
      if (path === "/knowledge/majors/major-1/directions") {
        return Promise.resolve([{ id: "direction-1", major_id: "major-1", name: "应用方向" }]);
      }
      if (path === "/knowledge/directions/direction-1/tree") {
        return Promise.resolve({
          nodes: [
            {
              id: "root-1",
              data: { id: "root-1", name: "数据库技术", parent_id: null, direction_id: "direction-1" },
            },
            {
              id: "child-1",
              data: { id: "child-1", name: "事务隔离级别", parent_id: "root-1", direction_id: "direction-1" },
            },
          ],
        });
      }
      return Promise.resolve({ recent: [], frequent: [] });
    });

    render(
      <KnowledgePointSelector
        fetcher={fetcher}
        selectedKnowledgePoints={[]}
        onSelectedKnowledgePointsChange={onChange}
        selectionTarget="root"
        selectionMode="single"
        showUsageShortcuts={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择知识点/i }));
    fireEvent.click(await screen.findByTitle("计算机科学与技术"));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith("/knowledge/majors/major-1/directions");
    });
    // 方向层已隐藏：主知识直接显示在专业下，路径不再包含方向。
    fireEvent.click(await screen.findByText("数据库技术"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        {
          id: "root-1",
          name: "数据库技术",
          path: "计算机科学与技术 > 数据库技术",
        },
      ]);
    });
    expect(onChange).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "child-1" }),
    ]));
  });
});
