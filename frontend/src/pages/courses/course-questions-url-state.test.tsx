import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";

vi.mock("@refinedev/core", () => ({
  useList: () => ({
    query: { data: { data: [], total: 0 }, isLoading: false },
    result: { data: [], total: 0 },
  }),
  useUpdate: () => ({ mutate: vi.fn(), mutation: { isPending: false } }),
  useDelete: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: vi.fn(async () => []),
}));

vi.mock("@/pages/courses/api", () => {
  const course = {
    id: "c1",
    name: "计算机网络",
    can_write: true,
    is_deleted: false,
    question_count: 10,
    material_count: 0,
    exam_count: 0,
    assignment_count: 0,
    paper_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    getTeacherCourse: vi.fn(async () => course),
    getCourseKnowledgeTree: vi.fn(async () => null),
    listCourseSemesters: vi.fn(async () => []),
    listCourseMaterials: vi.fn(async () => []),
    listCourseExams: vi.fn(async () => []),
    listCourseAssignments: vi.fn(async () => []),
    listCourseQuestions: vi.fn(async () => []),
    listCourseQuestionsPaginated: vi.fn(async () => ({
      items: [
        {
          id: "q1",
          type: "choice",
          title: "题目一",
          content: { text: "题目一" },
          options: [{ key: "A", value: "甲" }],
          answer: { correct: "A" },
          analysis: null,
          difficulty: 2,
          score: 5,
          usage_count: 0,
          question_bank_id: "b1",
          question_bank_name: "课程题库",
          tags: [],
          knowledge_points: [],
          created_by: "u1",
          created_by_name: "老师",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 10,
      type_counts: { choice: 10 },
    })),
    getCourseAssignmentScoreSummary: vi.fn(async () => null),
    getSeedUsage: vi.fn(async () => ({})),
    kbStatus: vi.fn(async () => ({})),
  };
});

vi.mock("@/pages/courses/question-gen-templates/api", () => ({
  getSeedUsage: vi.fn(async () => ({})),
  kbIngestMaterial: vi.fn(async () => []),
  kbStatus: vi.fn(async () => ({})),
}));

import { CourseDetailPage } from "@/pages/courses/detail";
import { useLocation as useLoc } from "react-router-dom";

function LocationProbe() {
  const location = useLoc();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function EditProbe() {
  const location = useLoc();
  const state = location.state as { backTo?: string } | null;
  return <div data-testid="edit-probe">{state?.backTo ?? "NO_STATE"}</div>;
}

describe("course detail url restoration", () => {
  it("mounts with ?types=choice and keeps the type filter", async () => {
    render(
      <MemoryRouter initialEntries={["/courses/c1?tab=questions&types=choice"]}>
        <Routes>
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/questions/edit/:id" element={<EditProbe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    const filterButton = await screen.findByRole("button", { name: /题型/ });
    expect(filterButton.textContent).toContain("选择题");

    const editButtons = await screen.findAllByRole("button", { name: /编辑/ });
    editButtons[editButtons.length - 1].click();
    // 从编辑页返回时必须回到带筛选条件的列表 URL，而不是默认的「全部题型」。
    const probe = await screen.findByTestId("edit-probe");
    expect(probe.textContent).toBe("/courses/c1?tab=questions&types=choice");
  });
});

describe("course questions filter url writes", () => {
  it("选择题型后 URL 里要保留 types，不会被页码重置覆盖", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/courses/c1?tab=questions"]}>
        <Routes>
          <Route path="/courses/:id" element={<CourseDetailPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    const filterButton = await screen.findByRole("button", { name: /题型/ });
    await user.click(filterButton);
    const option = await screen.findByRole("menuitemcheckbox", { name: /选择题/ });
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain(
        "types=choice",
      );
    });
  });
});
