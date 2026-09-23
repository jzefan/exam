import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PixelGrid, PixelLoader, PixelLoaderOverlay } from "./pixel-loader";

const cellsOf = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".pixel-loader-cell"));

describe("像素网格 loader", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("网格是 3×3 九格，中行领先 90ms 形成向右推进的 V 形波前", () => {
    const { container } = render(<PixelGrid />);
    const cells = cellsOf(container);
    expect(cells).toHaveLength(9);
    // 中行（索引 3/4/5）先亮，上下两行各晚 90ms —— 这就是 V 形波前。
    expect(cells.map(cell => cell.style.animationDelay))
      .toEqual(["90ms", "180ms", "270ms", "0ms", "90ms", "180ms", "90ms", "180ms", "270ms"]);
    expect(cells.every(cell => cell.style.animationName === "pixel-on")).toBe(true);
    expect(cells.every(cell => cell.style.animationDuration === "650ms")).toBe(true);
  });

  it("orbit 变体绕外圈，中心格保持熄灭", () => {
    const { container } = render(<PixelGrid variant="orbit" />);
    const cells = cellsOf(container);
    // 中心格不在外圈上：既没有动画，也停在最暗的一档，否则绕行会跳格。
    expect(cells[4].style.animationName).toBe("");
    expect(cells[4].style.opacity).toBe("0.07");
    expect(cells[0].style.animationDelay).toBe("0ms");
  });

  it("秒表按 0.1 秒推进，超过一分钟换成分", async () => {
    vi.useFakeTimers();
    render(<PixelLoader label="正在读取答卷" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取答卷");
    expect(screen.getByText("0.0s")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(screen.getByText("1.2s")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(59800); });
    expect(screen.getByText("1m 1.0s")).toBeInTheDocument();
  });

  it("关掉秒表时不渲染计时，也不留下空转的定时器", () => {
    vi.useFakeTimers();
    render(<PixelLoader label="正在读取学习通列表" elapsed={false} />);
    expect(screen.queryByText(/^\d+(\.\d+)?s$/)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("秒表对读屏隐藏，状态只念文案", () => {
    render(<PixelLoader label="AI 评分中" />);
    expect(screen.getByRole("status")).toHaveTextContent("AI 评分中");
    // 每 100ms 一跳的数字被 aria-hidden 挡住，读屏只会念一次「AI 评分中」。
    expect(screen.getByText("0.0s")).toHaveAttribute("aria-hidden", "true");
  });

  it("浮层钉在视口中央，且不吃滚动与点击", () => {
    render(<PixelLoaderOverlay label="正在读取答卷" />);
    const status = screen.getByRole("status");
    const overlay = status.closest("div");
    expect(overlay).not.toBeNull();
    const classes = overlay!.className.split(/\s+/);
    // fixed + 满屏 + 居中：位置与文档流无关，页面再长也在视线里。
    expect(classes).toEqual(expect.arrayContaining(["fixed", "inset-0", "items-center", "justify-center", "z-40"]));
    // 它只是指示灯：不该拦住滚动或点击（该禁用的按钮自己已经禁用了）。
    expect(classes).toContain("pointer-events-none");
    // 浮在正文之上：底板不透明 + 边框，压住表格也读得清。
    const panel = overlay!.firstElementChild!;
    expect(panel.className).toContain("bg-background/95");
    expect(panel.className).toContain("shadow-lg");
    expect(status).toHaveTextContent("正在读取答卷");
  });

  it("样式表保有网格配色、流光与关键帧，减弱动效时网格停在暗态", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    // 格子靠 currentColor 上色：普通文字里随文字灰、主色按钮里随按钮文字变白。
    expect(styles).toContain("@keyframes pixel-on");
    expect(styles).toContain("@keyframes pixel-shimmer");
    expect(styles).toContain("background-color: currentColor;");
    const section = styles.slice(styles.indexOf("@keyframes pixel-on"));
    expect(section).toContain("prefers-reduced-motion: reduce");
    expect(section).toContain("animation: none !important;");
  });
});
