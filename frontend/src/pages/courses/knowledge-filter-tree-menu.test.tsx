import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen, within } from "@/test/test-utils";

import type { CourseKnowledgeNode } from "./api";
import { KnowledgeFilterTreeMenu } from "./knowledge-filter-tree-menu";

function node(
  id: string,
  name: string,
  children: CourseKnowledgeNode[] = [],
): CourseKnowledgeNode {
  return { id, name, question_count: 0, material_count: 0, children };
}

const tree = node("course-kp", "计算机网络", [
  node("kp-physical", "物理层", [
    node("kp-media", "传输介质", [node("kp-twisted", "双绞线")]),
  ]),
  node("kp-network", "网络层"),
]);

const options = [
  { id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" },
  {
    id: "kp-media",
    name: "传输介质",
    path: "计算机网络 / 物理层 / 传输介质",
  },
  {
    id: "kp-twisted",
    name: "双绞线",
    path: "计算机网络 / 物理层 / 传输介质 / 双绞线",
  },
  { id: "kp-network", name: "网络层", path: "计算机网络 / 网络层" },
];

/** 取某个节点所在行里的展开 / 收起按钮（叶子节点也会渲染该按钮，故按行定位）。 */
function toggleFor(nodeName: string): HTMLElement {
  const nameButton = screen.getByText(nodeName).closest("button");
  const row = nameButton?.parentElement;
  if (!row) throw new Error(`找不到「${nodeName}」所在行`);
  return within(row).getByRole("button", { name: /知识点$/ });
}

function renderMenu(
  overrides: Partial<{
    tree: CourseKnowledgeNode | null;
    selectedId: string | null;
    onSelect: (nodeId: string | null) => void;
    onClose: () => void;
  }> = {},
) {
  return render(
    <KnowledgeFilterTreeMenu
      tree={overrides.tree === undefined ? tree : overrides.tree}
      options={options}
      selectedId={overrides.selectedId ?? null}
      onSelect={overrides.onSelect ?? vi.fn()}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  );
}

describe("KnowledgeFilterTreeMenu", () => {
  it("按层级展示：一级展开、更深层默认收起，可逐级展开与收起", async () => {
    const user = userEvent.setup();
    renderMenu();

    expect(screen.getByText("物理层")).toBeInTheDocument();
    expect(screen.getByText("网络层")).toBeInTheDocument();
    expect(screen.getByText("传输介质")).toBeInTheDocument();
    expect(screen.queryByText("双绞线")).not.toBeInTheDocument();

    await user.click(toggleFor("传输介质"));
    expect(screen.getByText("双绞线")).toBeInTheDocument();

    await user.click(toggleFor("物理层"));
    expect(screen.queryByText("传输介质")).not.toBeInTheDocument();
  });

  it("选中节点后回调 onSelect 并关闭菜单", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ selectedId: "kp-physical", onSelect, onClose });

    await user.click(screen.getByText("网络层"));
    expect(onSelect).toHaveBeenCalledWith("kp-network");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("全部知识点"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("没有知识树时退回平铺选项", () => {
    renderMenu({ tree: null });

    expect(screen.getByText("物理层")).toBeInTheDocument();
    expect(screen.getByText("传输介质")).toBeInTheDocument();
    expect(screen.getByText("双绞线")).toBeInTheDocument();
  });
});
