import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeCatalogWebDialog } from "./KnowledgeCatalogWebDialog";

const searchCatalogBooksMock = vi.fn();
const fetchCatalogFromWebMock = vi.fn();
const recognizeCatalogCoverMock = vi.fn();

vi.mock("./catalog-web-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog-web-api")>();
  return {
    ...actual,
    searchCatalogBooks: (...args: unknown[]) => searchCatalogBooksMock(...args),
    fetchCatalogFromWeb: (...args: unknown[]) => fetchCatalogFromWebMock(...args),
    recognizeCatalogCover: (...args: unknown[]) => recognizeCatalogCoverMock(...args),
  };
});

const CANDIDATE = {
  title: "计算机网络 谢希仁 第8版",
  url: "https://product.dangdang.com/1.html",
  author: "谢希仁",
  publisher: "电子工业出版社",
  publish_date: "2021-06-01",
  edition: "第8版",
  price: "40.70",
  source: "dangdang",
};

function renderDialog(overrides: Partial<Parameters<typeof KnowledgeCatalogWebDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onImport: vi.fn().mockResolvedValue(undefined),
    selectedTargetName: "计算机网络",
    lockedRootName: "计算机网络",
    existingRootNames: [],
    ...overrides,
  };
  render(<KnowledgeCatalogWebDialog {...props} />);
  return props;
}

describe("KnowledgeCatalogWebDialog", () => {
  beforeEach(() => {
    searchCatalogBooksMock.mockReset();
    fetchCatalogFromWebMock.mockReset();
    recognizeCatalogCoverMock.mockReset();
  });

  it("walks 填写书名 → 确认书目 → 校对并导入", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockResolvedValue({
      paths: [["第一章 概述", "1.1 互联网概述"], ["第二章 物理层"]],
      source: "llm" as const,
      source_url: "",
      publisher_site: "",
      notes: "以下内容由大模型推断，请逐条确认后再导入。",
    });
    const props = renderDialog();

    // 第 1 步：填写书名并检索
    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络 谢希仁");
    await user.click(screen.getByRole("button", { name: "检索图书" }));

    expect(searchCatalogBooksMock).toHaveBeenCalledWith({ keyword: "计算机网络 谢希仁" });

    // 第 2 步：候选卡片只给书名 / 版本 / 作者 / 出版社 / 年份，不带价格与广告词。
    expect(screen.getByText("第8版")).toBeInTheDocument();
    expect(screen.getByText(/谢希仁 · 电子工业出版社 · 2021/)).toBeInTheDocument();
    expect(screen.queryByText(/¥/)).not.toBeInTheDocument();

    // 选中候选书目后自动进入预览
    const candidate = await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ });
    await user.click(candidate);

    expect(fetchCatalogFromWebMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: CANDIDATE.title, publisher: "电子工业出版社" }),
    );

    // 第 3 步：来源标注与目录条目可见，确认导入
    expect(await screen.findByText("大模型推断")).toBeInTheDocument();
    expect(screen.getByText(/以下内容由大模型推断/)).toBeInTheDocument();
    expect(screen.getByText("1.1 互联网概述")).toBeInTheDocument();
    expect(screen.getByText(/共 2 条/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(props.onImport).toHaveBeenCalledWith([
        ["第一章 概述", "1.1 互联网概述"],
        ["第二章 物理层"],
      ]);
    });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps 确认导入 disabled until a catalog is fetched", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([]);
    renderDialog();

    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "不存在的书");
    await user.click(screen.getByRole("button", { name: "检索图书" }));

    expect(await screen.findByText(/没有检索到这本书/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
  });

  it("surfaces a fetch failure and stays on the pick step", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockRejectedValue(
      new Error('{"detail":"没能获取到这本书的目录。"}'),
    );
    const props = renderDialog();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络");
    await user.click(screen.getByRole("button", { name: "检索图书" }));
    await user.click(await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ }));

    expect(await screen.findByText("没能获取到这本书的目录。")).toBeInTheDocument();
    expect(props.onImport).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
  });

  it("opens the same catalog editor as 课程详情 → 目录 does for 编辑目录", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockResolvedValue({
      paths: [
        ["第一章 概述", "1.1 互联网概述"],
        ["第二章 物理层"],
      ],
      source: "llm" as const,
      source_url: "",
      publisher_site: "",
      notes: "",
    });
    const props = renderDialog();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络");
    await user.click(screen.getByRole("button", { name: "检索图书" }));
    await user.click(await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ }));
    await screen.findByText("1.1 互联网概述");

    await user.click(screen.getByRole("button", { name: "编辑目录" }));

    // 与「课程详情 → 目录 → 编辑目录」同款版式：左知识树 + 右节点编辑。
    expect(screen.getByRole("heading", { name: "编辑课程目录" })).toBeInTheDocument();
    expect(screen.getByText("知识树")).toBeInTheDocument();
    // 默认选中树根（课程本身），根节点不可改名、不可删除。
    expect(screen.getByRole("heading", { name: "计算机网络" })).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();

    // 选中章节改名：所有经过它的路径在同一层一起改。
    await user.click(screen.getByText("第一章 概述"));
    const nameInput = screen.getByLabelText("名称");
    await user.clear(nameInput);
    await user.type(nameInput, "第一章 计算机网络概述");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("计算机网络 / 第一章 计算机网络概述")).toBeInTheDocument();

    // 给该章补一节。
    await user.type(screen.getByLabelText("新增子知识点"), "1.3 计算机网络的性能");
    await user.click(screen.getByRole("button", { name: "新增子知识点" }));

    // 返回目录回到预览，改动已经生效。
    await user.click(screen.getByRole("button", { name: "返回目录" }));
    expect(await screen.findByText("1.3 计算机网络的性能")).toBeInTheDocument();
    expect(screen.getByText(/共 3 条/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(props.onImport).toHaveBeenCalledWith([
        ["第一章 计算机网络概述", "1.1 互联网概述"],
        ["第二章 物理层"],
        ["第一章 计算机网络概述", "1.3 计算机网络的性能"],
      ]);
    });
  });

  it("deletes a draft node only after the inline confirmation", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockResolvedValue({
      paths: [
        ["第一章 概述", "1.1 互联网概述"],
        ["第二章 物理层"],
      ],
      source: "llm" as const,
      source_url: "",
      publisher_site: "",
      notes: "",
    });
    renderDialog();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络");
    await user.click(screen.getByRole("button", { name: "检索图书" }));
    await user.click(await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ }));
    await screen.findByText("1.1 互联网概述");

    await user.click(screen.getByRole("button", { name: "编辑目录" }));
    await user.click(screen.getByText("第二章 物理层"));
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(screen.getByText("删除后不可恢复，其下级节点会一并删除")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.queryByText("第二章 物理层")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回目录" }));
    expect(await screen.findByText(/共 1 条/)).toBeInTheDocument();
  });

  it("keeps the bulk text editor reachable from the tree editor", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockResolvedValue({
      paths: [["第一章 概述"]],
      source: "llm" as const,
      source_url: "",
      publisher_site: "",
      notes: "",
    });
    const props = renderDialog();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络");
    await user.click(screen.getByRole("button", { name: "检索图书" }));
    await user.click(await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ }));
    await screen.findByText("第一章 概述");

    await user.click(screen.getByRole("button", { name: "编辑目录" }));
    await user.click(screen.getByRole("button", { name: "批量编辑" }));

    const textarea = screen.getByLabelText("目录文本");
    await user.clear(textarea);
    await user.type(textarea, "第一章 概述 > 1.1 互联网概述");
    await user.click(screen.getByRole("button", { name: "完成编辑" }));

    expect(await screen.findByText("1.1 互联网概述")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => {
      expect(props.onImport).toHaveBeenCalledWith([["第一章 概述", "1.1 互联网概述"]]);
    });
  });

  it("disables later steps until the data behind them exists", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "2 确认是哪一本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3 校对目录并导入" })).toBeDisabled();
  });

  it("lets the teacher jump back to earlier steps from the preview", async () => {
    const user = userEvent.setup();
    searchCatalogBooksMock.mockResolvedValue([CANDIDATE]);
    fetchCatalogFromWebMock.mockResolvedValue({
      paths: [["第一章 概述", "1.1 互联网概述"]],
      source: "llm" as const,
      source_url: "",
      publisher_site: "",
      notes: "",
    });
    renderDialog();

    await user.type(screen.getByLabelText(/书名 \/ ISBN/), "计算机网络");
    await user.click(screen.getByRole("button", { name: "检索图书" }));
    await user.click(await screen.findByRole("button", { name: /计算机网络 谢希仁 第8版/ }));
    await screen.findByText("1.1 互联网概述");

    // 退回第 1 步：输入框带着当前书名（选中那一本的标题）回来，第 2 / 第 3 步的数据也还在。
    await user.click(screen.getByRole("button", { name: "1 填写书名 / 上传封面" }));
    expect(screen.getByLabelText(/书名 \/ ISBN/)).toHaveValue(CANDIDATE.title);

    await user.click(screen.getByRole("button", { name: "2 确认是哪一本" }));
    expect(await screen.findByText(/命中 1 本/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "3 校对目录并导入" }));
    expect(await screen.findByText("1.1 互联网概述")).toBeInTheDocument();
  });
});
