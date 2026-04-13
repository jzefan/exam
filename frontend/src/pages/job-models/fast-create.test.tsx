import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, beforeEach, vi } from "vitest"

import { JobModelFastCreate } from "./fast-create"
import { JobModelUploadAI } from "./upload-ai"

const navigateMock = vi.fn()
const fetchMock = vi.fn()

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}))

beforeEach(() => {
  navigateMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe("JobModelFastCreate", () => {
  it("requests recommendation and creates an enterprise copy from the backend", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "std-1",
          current_version_id: "std-ver-1",
          job_role: "Java 后端工程师",
          industry_name: "软件和信息服务",
          direction_name: "工业软件",
          job_family: "后端开发",
          rationale: "推荐理由",
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          job_model_id: "ent-1",
          version_id: "ver-1",
        }),
      )

    render(<JobModelFastCreate />)

    await userEvent.type(
      screen.getByPlaceholderText(/例如：负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计/i),
      "负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计",
    )
    await userEvent.click(screen.getByRole("button", { name: "立即解析文本" }))

    await screen.findByText("推荐标准岗位")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/job-models/models/recommend-standard",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ job_text: "负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计" }),
      }),
    )
    expect(screen.getByText("Java 后端工程师")).toBeInTheDocument()
    expect(
      screen.getByText("确认标准岗位后，系统会基于该标准模型创建企业版岗位模型，并跳转到已有详情编辑器继续完善。")
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "使用该标准岗位继续" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/job-models/models/std-1/create-enterprise-copy",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            enterprise_name: "Java 后端工程师 企业版",
            version_note: "AI 初始生成",
          }),
        }),
      ),
    )
    expect(navigateMock).toHaveBeenCalledWith("/gwmx/job-models/ent-1/versions/ver-1/editor")
  })

  it("switches the recommended standard model when the backend returns a python role", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        id: "std-2",
        current_version_id: "std-ver-2",
        job_role: "Python 开发工程师",
        industry_name: "软件和信息服务",
        direction_name: "数据智能",
        job_family: "后端开发",
        rationale: "推荐理由",
      }),
    )

    render(<JobModelFastCreate />)

    await userEvent.type(
      screen.getByPlaceholderText(/例如：负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计/i),
      "负责 Python 数据接口与分析服务开发"
    )
    await userEvent.click(screen.getByRole("button", { name: "立即解析文本" }))

    expect(await screen.findByText("Python 开发工程师")).toBeInTheDocument()
  })

  it("stays on upload step and shows an error when recommendation fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "No standard model matched" }),
    } as Response)

    render(<JobModelFastCreate />)

    await userEvent.type(
      screen.getByPlaceholderText(/例如：负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计/i),
      "一段没有匹配标准岗位的描述",
    )
    await userEvent.click(screen.getByRole("button", { name: "立即解析文本" }))

    expect(await screen.findByText("标准岗位推荐失败")).toBeInTheDocument()
    expect(screen.queryByText("推荐标准岗位")).not.toBeInTheDocument()
  })
})

describe("JobModelUploadAI", () => {
  it("acts as a unified entry that jumps to fast create", async () => {
    render(<JobModelUploadAI />)

    await userEvent.click(screen.getByRole("button", { name: "进入企业快速生成" }))

    expect(navigateMock).toHaveBeenCalledWith("/gwmx/job-models/fast-create")
  })
})
