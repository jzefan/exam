import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

import { OnboardingGuide } from "./onboarding-guide";
import { ONBOARDING_REASON_STORAGE_KEY } from "@/providers/auth-provider";

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>;
}

function renderGuide(enabled = true) {
  return render(
    <MemoryRouter>
      <OnboardingGuide enabled={enabled} />
      <CurrentPath />
    </MemoryRouter>,
  );
}

describe("OnboardingGuide", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the welcome step for a first-login teacher", async () => {
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "first_login");
    renderGuide();

    expect(await screen.findByText("教学工作快速上手")).toBeInTheDocument();
    expect(screen.getByText(/欢迎加入/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始引导/ })).toBeInTheDocument();
  });

  it("uses the returning-user copy when reason is returning_after_week", async () => {
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "returning_after_week");
    renderGuide();

    expect(await screen.findByText(/欢迎回来/)).toBeInTheDocument();
  });

  it("renders nothing when disabled, even if a reason is stored", () => {
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "first_login");
    renderGuide(false);

    expect(screen.queryByText("教学工作快速上手")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no onboarding reason", () => {
    renderGuide();

    expect(screen.queryByText("教学工作快速上手")).not.toBeInTheDocument();
  });

  it("advances from welcome into the first spotlight step", async () => {
    const user = userEvent.setup();
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "first_login");
    renderGuide();

    await user.click(await screen.findByRole("button", { name: /开始引导/ }));

    // Tour bubble renders its content even when the target element is absent
    // (centered fallback), so the progress indicator is unique to it.
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    expect(screen.queryByText(/欢迎加入/)).not.toBeInTheDocument();
  });

  it("clears the stored reason when skipped from the welcome step", async () => {
    const user = userEvent.setup();
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "first_login");
    renderGuide();

    await user.click(await screen.findByRole("button", { name: "跳过" }));

    expect(localStorage.getItem(ONBOARDING_REASON_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("教学工作快速上手")).not.toBeInTheDocument();
  });

  it("walks through every step and clears the reason on 完成", async () => {
    const user = userEvent.setup();
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, "first_login");
    renderGuide();

    await user.click(await screen.findByRole("button", { name: /开始引导/ }));

    // Steps 1 → 3
    await user.click(await screen.findByRole("button", { name: /下一步/ }));
    await user.click(await screen.findByRole("button", { name: /下一步/ }));

    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完成" }));

    expect(localStorage.getItem(ONBOARDING_REASON_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("3 / 3")).not.toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent("/dashboard");
  });
});
