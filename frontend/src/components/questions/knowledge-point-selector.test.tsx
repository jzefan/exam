import { fireEvent, render, screen } from "@testing-library/react";
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
});
