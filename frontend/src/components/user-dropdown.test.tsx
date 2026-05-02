import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

import { UserDropdown } from "./user-dropdown";

describe("UserDropdown", () => {
  it("uses student management wording for teacher persona", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserDropdown name="Teacher" role="teacher" persona="teacher" onLogout={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Teacher/ }));

    expect(screen.getByRole("menuitem", { name: /学生管理/ })).toBeInTheDocument();
  });

  it("uses candidate management wording for assessor persona", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserDropdown name="Assessor" role="evaluator" persona="assessor" onLogout={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Assessor/ }));

    expect(screen.getByRole("menuitem", { name: /考生管理/ })).toBeInTheDocument();
  });
});
