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
          model: {
            id: "std-1",
            current_version_id: "std-ver-1",
            job_role: "Java 后端工程师",
            industry_name: "软件和信息服务",
            direction_name: "工业软件",
            job_family: "后端开发",
          },
          rationale: "推荐理由",
          confidence: 0.9,
          matched_keywords: ["java", "spring"],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          dimensions: [
            {
              id: "dim-1",
              name: "核心技能",
              skills: [
                {
                  id: "skill-1",
                  name: "Spring Boot",
                  level: "L3",
                  status: "matched",
                  jd_skill_name: "Spring Boot",
                  knowledge_points: [
                    {
                      id: "kp-1",
                      name: "依赖注入",
                      difficulty: "中级",
                      status: "matched",
                      jd_kp_name: "DI",
                    },
                    {
                      id: "kp-2",
                      name: "自动配置",
                      difficulty: "中级",
                      status: "extra",
                      jd_kp_name: null,
                    },
                  ],
                },
                {
                  id: "skill-2",
                  name: "Kafka",
                  level: "L2",
                  status: "extra",
                  jd_skill_name: null,
                  knowledge_points: [],
                },
              ],
            },
          ],
          missing_skills: [
            {
              name: "Redis",
              suggested_level: "L2",
              dimension_hint: "核心技能",
              missing_kps: ["缓存穿透"],
            },
          ],
          missing_knowledge_points: [
            {
              name: "分布式锁",
              parent_skill_hint_id: "skill-1",
              parent_skill_hint_name: "Spring Boot",
            },
          ],
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

    await userEvent.click(screen.getByRole("button", { name: "使用该标准岗位继续" }))

    // 进入 match 步骤，等待 SkillMatchPanel 渲染
    expect(await screen.findByText("校准技能与知识点")).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/job-models/models/std-1/match-skills",
      ),
    ).toBe(true)

    // 创建企业版
    await userEvent.click(screen.getByRole("button", { name: /创建企业版岗位模型/ }))

    await waitFor(() => {
      const copyCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/job-models/models/std-1/create-enterprise-copy",
      )
      expect(copyCall).toBeTruthy()
      const body = JSON.parse(copyCall![1].body as string)
      expect(body.enterprise_name).toMatch(/^Java 后端工程师 企业版 \d{8}-\d{4}$/)
      expect(body.version_note).toBe("基于 AI 推荐的标准岗位 + 技能对照生成")
      expect(Array.isArray(body.selected_standard_skill_ids)).toBe(true)
      expect(body.selected_standard_skill_ids).toContain("skill-1")
      expect(Array.isArray(body.selected_standard_kp_ids)).toBe(true)
      expect(body.selected_standard_kp_ids).toContain("kp-1")
      expect(Array.isArray(body.added_skills)).toBe(true)
      expect(body.added_skills[0]).toMatchObject({ name: "Redis" })
      expect(Array.isArray(body.added_knowledge_points)).toBe(true)
      // missing_skills 下挂的 KP 作为新增知识点，父技能名为新增技能名
      expect(body.added_knowledge_points).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "缓存穿透", parent_skill_name: "Redis" }),
          expect.objectContaining({ name: "分布式锁", parent_skill_id: "skill-1" }),
        ]),
      )
    })
    expect(navigateMock).toHaveBeenCalledWith("/gwmx/job-models/ent-1/versions/ver-1/editor")
  })

  it("switches the recommended standard model when the backend returns a python role", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        model: {
          id: "std-2",
          current_version_id: "std-ver-2",
          job_role: "Python 开发工程师",
          industry_name: "软件和信息服务",
          direction_name: "数据智能",
          job_family: "后端开发",
        },
        rationale: "推荐理由",
        confidence: 0.85,
        matched_keywords: ["python"],
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

    expect(await screen.findByText("No standard model matched")).toBeInTheDocument()
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
