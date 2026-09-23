/* ─────────────────────────────────────────────────────────
 * 等待状态：3×3 像素网格 + 流光文案 + 实时秒表
 *
 * 用途：面向外部站点的长等待（读取学习通页面、抓答卷、排队评分），
 * 这类等待动辄十几秒，需要让教师看出「还在动」以及「已经等了多久」。
 *
 * 变体：
 *   drive — 方格，向右推进的 V 形波前（默认）
 *   dots  — 同波前，圆形格
 *   orbit — 沿网格外圈绕行的彗星
 *
 * 波前周期（650ms）短于扫掠全长（270ms 最大延迟 + 650ms ≈ 920ms），所以屏幕上始终有两道波前。
 *
 * 颜色走 `currentColor`，因此普通文字里是灰、在主色按钮里是白，深浅色主题都不用另配。
 * 同屏只应有一个秒表（`elapsed={false}` 关掉多余的），否则两个数字一起跳很吵。
 * ───────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type PixelLoaderVariant = "drive" | "dots" | "orbit";

// 每格的点亮延迟（毫秒）：列索引 + 到中行的距离 → 中行领先、上下两行各晚 90ms 的 V 形波前。
const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
// 中心格不在外圈上，固定暗着，绕行才不会跳格。
const orbit = Array.from({ length: 9 }, (_, index) => {
  const step = ORBIT_ORDER.indexOf(index);
  return step === -1 ? null : step * 110;
});

const PATTERNS: Record<PixelLoaderVariant, { delays: (number | null)[]; duration: number; round: boolean }> = {
  drive: { delays: chevron, duration: 650, round: false },
  dots: { delays: chevron, duration: 650, round: true },
  orbit: { delays: orbit, duration: 950, round: false },
};

/** 只有网格，供按钮这类空间很小、且按钮文案已经说明在做什么的位置使用。 */
export function PixelGrid({ variant = "drive", className }: { variant?: PixelLoaderVariant; className?: string }) {
  const { delays, duration, round } = PATTERNS[variant];
  return <span aria-hidden="true" className={cn("grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]", className)}>
    {delays.map((delay, index) => <span
      key={index}
      className={cn("pixel-loader-cell size-[4px]", round ? "rounded-full" : "rounded-[1px]")}
      style={{
        opacity: delay === null ? 0.07 : 0.15,
        // 关键帧里给的 opacity 优先级高于这里的行内初值，所以静息态就是上面那个值。
        // 拆成长写：animation 简写在部分环境（含 jsdom）里会被整条丢掉。
        animationName: delay === null ? undefined : "pixel-on",
        animationDuration: `${duration}ms`,
        animationTimingFunction: "ease-in-out",
        animationDelay: `${delay ?? 0}ms`,
        animationIterationCount: "infinite",
      }}
    />)}
  </span>;
}

function useElapsed(active: boolean) {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    // `active` 在同一个使用点上是常量，所以 ticks 天然从 0 开始，不用在 effect 里回零
    // （同步 setState 会触发级联渲染，react-hooks 也会拦）。
    if (!active) return;
    const timer = window.setInterval(() => setTicks(value => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return "";
  const total = ticks / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export function PixelLoader({ label, variant = "drive", elapsed = true, className }: {
  /** 说清在等什么，例如「正在读取答卷」。 */
  label: string;
  variant?: PixelLoaderVariant;
  /** 同屏已经有秒表时关掉。 */
  elapsed?: boolean;
  className?: string;
}) {
  const time = useElapsed(elapsed);
  return <span role="status" className={cn("inline-flex items-center gap-2.5 text-muted-foreground", className)}>
    <PixelGrid variant={variant} />
    <span className="pixel-loader-label text-[13px] font-medium">{label}</span>
    {/* aria-hidden：秒表每 100ms 一跳，别让读屏跟着念。 */}
    {time && <span aria-hidden="true" className="font-mono text-[12px] tabular-nums">{time}</span>}
  </span>;
}

/**
 * 把等待提示钉在视口中央的浮层。
 *
 * 读取学习通动辄十几秒，提示若跟着文档流走，页面一长就跑到屏幕外，教师得往下翻才
 * 知道还在不在读。浮层与滚动位置无关，等待状态永远在眼睛所在的位置。
 *
 * `pointer-events-none`：它只是个指示灯，不该拦住滚动或点击（该禁用的按钮自己已经禁用了）。
 * 层级取 z-40，低于 Dialog 的 z-50，登录弹窗不会被它盖住。
 */
export function PixelLoaderOverlay({ label, variant = "drive", className }: {
  label: string;
  variant?: PixelLoaderVariant;
  className?: string;
}) {
  return <div className={cn("pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4", className)}>
    <span className="flex items-center rounded-md border border-border bg-background/95 px-4 py-2.5 shadow-lg">
      <PixelLoader label={label} variant={variant} />
    </span>
  </div>;
}
