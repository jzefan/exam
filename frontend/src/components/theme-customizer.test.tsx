import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";

import { ThemeConfigProvider, useThemeConfig } from "./theme-customizer";
import { ThemeProvider, useTheme } from "./theme-provider";

function ThemeProbe() {
  const { setTheme } = useTheme();
  const { setColor } = useThemeConfig();

  return (
    <div>
      <button onClick={() => setColor("blue")}>blue</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("dark")}>dark</button>
    </div>
  );
}

describe("Theme customization", () => {
  it("applies different primary tokens for light and dark mode", async () => {
    render(
      <ThemeProvider>
        <ThemeConfigProvider>
          <ThemeProbe />
        </ThemeConfigProvider>
      </ThemeProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "blue" }).click();
      screen.getByRole("button", { name: "light" }).click();
    });

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("221.2 83.2% 53.3%");

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("217.2 91.2% 59.8%");
  });
});
