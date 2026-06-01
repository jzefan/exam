import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";
import { AUTH_CHANGED_EVENT } from "@/lib/active-user";

import { ThemeConfigProvider, useThemeConfig } from "./theme-customizer";
import { ThemeProvider } from "./theme-provider";

function ColorProbe() {
  const { config, setColor } = useThemeConfig();
  return (
    <div>
      <span data-testid="color">{config.color}</span>
      <button onClick={() => setColor("green")}>green</button>
    </div>
  );
}

function setUser(id: string | null) {
  if (id === null) {
    localStorage.removeItem("user");
  } else {
    localStorage.setItem("user", JSON.stringify({ id }));
  }
  act(() => {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  });
}

function renderProbe() {
  render(
    <ThemeProvider>
      <ThemeConfigProvider>
        <ColorProbe />
      </ThemeConfigProvider>
    </ThemeProvider>,
  );
}

describe("per-account theme isolation", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("a new user defaults to blue instead of inheriting the previous user's theme", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "user-a" }));
    renderProbe();

    // User A customizes to green.
    await act(async () => {
      screen.getByRole("button", { name: "green" }).click();
    });
    expect(screen.getByTestId("color").textContent).toBe("green");

    // User B (new user) logs in on the same browser → blue default.
    setUser("user-b");
    expect(screen.getByTestId("color").textContent).toBe("blue");

    // User A returns → their own green is restored.
    setUser("user-a");
    expect(screen.getByTestId("color").textContent).toBe("green");
  });

  it("logging out drops back to the blue default", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "user-a" }));
    renderProbe();

    await act(async () => {
      screen.getByRole("button", { name: "green" }).click();
    });
    expect(screen.getByTestId("color").textContent).toBe("green");

    setUser(null); // logout
    expect(screen.getByTestId("color").textContent).toBe("blue");
  });
});
