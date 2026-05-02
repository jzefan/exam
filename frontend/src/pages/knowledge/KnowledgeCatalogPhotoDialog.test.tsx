import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeCatalogPhotoDialog } from "./KnowledgeCatalogPhotoDialog";

const toastMock = vi.fn();
const extractCatalogPhotoImagesMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("./import-knowledge-photo-utils", () => ({
  extractCatalogPhotoImages: (...args: unknown[]) => extractCatalogPhotoImagesMock(...args),
}));

describe("KnowledgeCatalogPhotoDialog", () => {
  beforeEach(() => {
    toastMock.mockReset();
    extractCatalogPhotoImagesMock.mockReset();
  });

  it("keeps import enabled after recognition and shows a toast for missing root name", async () => {
    const user = userEvent.setup();
    const onRecognize = vi.fn().mockResolvedValue([["第一章", "1.1 绪论"]]);
    const onImport = vi.fn().mockResolvedValue(undefined);

    extractCatalogPhotoImagesMock.mockResolvedValue([
      {
        id: "img-1",
        name: "catalog.png",
        src: "data:image/png;base64,ZmFrZQ==",
      },
    ]);

    render(
      <KnowledgeCatalogPhotoDialog
        existingRootNames={[]}
        open
        onImport={onImport}
        onOpenChange={vi.fn()}
        onRecognize={onRecognize}
        selectedDirectionName="数据结构"
      />,
    );

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await user.upload(fileInput as HTMLInputElement, new File(["fake"], "catalog.png", { type: "image/png" }));

    await user.click(screen.getByRole("button", { name: "开始识别" }));

    await waitFor(() => {
      expect(onRecognize).toHaveBeenCalledTimes(1);
    });

    const importButton = screen.getByRole("button", { name: "确认导入" });
    expect(importButton).toBeEnabled();

    await user.click(importButton);

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "top",
        title: "请填写主知识点名称",
      }),
    );
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("warns immediately when the root knowledge name already exists in the selected direction", async () => {
    const user = userEvent.setup();
    const onRecognize = vi.fn().mockResolvedValue([["第一章", "1.1 绪论"]]);
    const onImport = vi.fn().mockResolvedValue(undefined);

    extractCatalogPhotoImagesMock.mockResolvedValue([
      {
        id: "img-1",
        name: "catalog.png",
        src: "data:image/png;base64,ZmFrZQ==",
      },
    ]);

    render(
      <KnowledgeCatalogPhotoDialog
        existingRootNames={["计算机网络"]}
        open
        onImport={onImport}
        onOpenChange={vi.fn()}
        onRecognize={onRecognize}
        selectedDirectionName="网络工程"
      />,
    );

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await user.upload(fileInput as HTMLInputElement, new File(["fake"], "catalog.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "开始识别" }));

    await waitFor(() => {
      expect(onRecognize).toHaveBeenCalledTimes(1);
    });

    await user.type(screen.getByLabelText(/主知识点名称/), " 计算机网络 ");

    expect(screen.getByText("当前方向下已存在同名主知识点，请换一个名称。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
