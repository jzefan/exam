import { describe, expect, it, vi, beforeEach } from "vitest";

const putMock = vi.fn();
const patchMock = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: {
        request: {
          use: vi.fn(),
        },
      },
      get: vi.fn(),
      post: vi.fn(),
      put: putMock,
      patch: patchMock,
      delete: vi.fn(),
    }),
  },
}));

describe("dataProvider.update", () => {
  beforeEach(() => {
    putMock.mockReset();
    patchMock.mockReset();
    putMock.mockResolvedValue({ data: { id: "user-1" } });
    patchMock.mockResolvedValue({ data: { id: "exam-1" } });
  });

  it("uses PATCH for exams updates", async () => {
    const { dataProvider } = await import("./data-provider");

    await dataProvider.update({
      resource: "exams",
      id: "exam-1",
      variables: { title: "Updated exam" },
    });

    expect(patchMock).toHaveBeenCalledWith("/api/exams/exam-1", { title: "Updated exam" });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("keeps using PUT for non-exam resources", async () => {
    const { dataProvider } = await import("./data-provider");

    await dataProvider.update({
      resource: "users",
      id: "user-1",
      variables: { full_name: "Updated user" },
    });

    expect(putMock).toHaveBeenCalledWith("/api/users/user-1", { full_name: "Updated user" });
    expect(patchMock).not.toHaveBeenCalled();
  });
});
