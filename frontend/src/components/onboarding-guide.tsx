import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, GraduationCap, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ONBOARDING_REASON_STORAGE_KEY } from "@/providers/auth-provider";

interface TourStep {
  title: string;
  description: string;
  /** Route to jump to before highlighting, so the user perceives the menu order. */
  path: string;
  /** Always-present element to spotlight (top nav item / dashboard quick action). */
  selector: string;
}

const STEPS: readonly TourStep[] = [
  {
    title: "添加学生",
    description: "先在「学生管理」录入或批量导入学生，建立名单——后续的课程、练习和考试都基于它。",
    path: "/",
    selector: '[data-onboarding="qa-students"]',
  },
  {
    title: "我的课程",
    description: "进入课程工作区：创建课程、组织学期、上传 PDF / Word / PPT 沉淀知识，并用 AI 生成题目，都在这里完成。",
    path: "/courses",
    selector: '[data-onboarding="nav-courses"]',
  },
  {
    title: "题库管理",
    description: "题目统一沉淀在题库，可浏览、导入、打标签，并维护知识点的层级与依赖。",
    path: "/questions",
    selector: '[data-onboarding="nav-questions"]',
  },
] as const;

const SPOT_PADDING = 8;
const BUBBLE_WIDTH = 340;
const BUBBLE_GAP = 14;

function hasRect(rect: DOMRect | null): rect is DOMRect {
  return rect !== null && (rect.width > 0 || rect.height > 0);
}

// requestAnimationFrame is absent in non-visual jsdom; fall back to a timer.
const scheduleFrame = (cb: FrameRequestCallback): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), 16) as unknown as number);

const cancelFrame = (id: number): void =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id);

/** Anchor the bubble beside the spotlight; fall back to screen center. */
function getBubbleStyle(rect: DOMRect | null): CSSProperties {
  if (!hasRect(rect) || typeof window === "undefined") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const placeBelow = vh - rect.bottom >= rect.top;
  const left = Math.max(
    BUBBLE_GAP,
    Math.min(rect.left + rect.width / 2 - BUBBLE_WIDTH / 2, vw - BUBBLE_WIDTH - BUBBLE_GAP),
  );
  return placeBelow
    ? { top: rect.bottom + SPOT_PADDING + BUBBLE_GAP, left }
    : { bottom: vh - rect.top + SPOT_PADDING + BUBBLE_GAP, left };
}

export function OnboardingGuide({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The reason is written to localStorage at login, before this mounts, so a
  // one-shot read is enough — deriving it avoids a setState-in-effect sync.
  const [storedReason] = useState<string | null>(() =>
    typeof localStorage === "undefined" ? null : localStorage.getItem(ONBOARDING_REASON_STORAGE_KEY),
  );
  const [dismissed, setDismissed] = useState(false);
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  // Tie the measured rect to its step so a step change clears the spotlight
  // without an extra synchronous setState.
  const [spot, setSpot] = useState<{ index: number; rect: DOMRect } | null>(null);

  const reason = enabled && !dismissed ? storedReason : null;
  const active = reason !== null;

  // Jump to the step's menu, then poll for the element to spotlight.
  useEffect(() => {
    if (!active || !started) return;
    const step = STEPS[stepIndex];
    if (location.pathname !== step.path) {
      navigate(step.path);
    }

    let frame = 0;
    let cancelled = false;
    const deadline = Date.now() + 1500;
    const locate = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector);
      if (el) {
        el.scrollIntoView?.({ block: "center", inline: "center" });
        setSpot({ index: stepIndex, rect: el.getBoundingClientRect() });
        return;
      }
      if (Date.now() <= deadline) {
        frame = scheduleFrame(locate);
      }
    };

    frame = scheduleFrame(locate);
    return () => {
      cancelled = true;
      cancelFrame(frame);
    };
  }, [active, started, stepIndex, location.pathname, navigate]);

  // Keep the spotlight aligned while the page scrolls or resizes.
  useEffect(() => {
    if (!active || !started) return;
    const { selector } = STEPS[stepIndex];
    const reposition = () => {
      const el = document.querySelector(selector);
      if (el) setSpot({ index: stepIndex, rect: el.getBoundingClientRect() });
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [active, started, stepIndex]);

  const dismiss = useCallback(() => {
    localStorage.removeItem(ONBOARDING_REASON_STORAGE_KEY);
    setDismissed(true);
    setStarted(false);
    setStepIndex(0);
    setSpot(null);
  }, []);

  const complete = useCallback(() => {
    dismiss();
    navigate("/dashboard");
  }, [dismiss, navigate]);

  if (!active) return null;

  if (!started) {
    return (
      <WelcomeOverlay
        reason={reason}
        onStart={() => {
          setStepIndex(0);
          setStarted(true);
        }}
        onSkip={dismiss}
      />
    );
  }

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const rect = spot && spot.index === stepIndex ? spot.rect : null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="教师新手引导">
      {hasRect(rect) ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all"
          style={{
            top: rect.top - SPOT_PADDING,
            left: rect.left - SPOT_PADDING,
            width: rect.width + SPOT_PADDING * 2,
            height: rect.height + SPOT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="absolute w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        style={getBubbleStyle(rect)}
      >
        <div className="flex items-center justify-between gap-2 bg-primary px-4 py-3 text-primary-foreground">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-foreground/20 text-xs font-semibold">
              {stepIndex + 1}
            </span>
            <p className="text-sm font-semibold">{step.title}</p>
          </div>
          <button
            type="button"
            aria-label="关闭新手引导"
            onClick={dismiss}
            className="rounded-full p-1 text-primary-foreground/80 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs leading-5 text-muted-foreground">{step.description}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {stepIndex + 1} / {STEPS.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft size={15} />
                上一步
              </Button>
              {isLast ? (
                <Button type="button" size="sm" onClick={complete}>
                  完成
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStepIndex((current) => Math.min(STEPS.length - 1, current + 1))}
                >
                  下一步
                  <ChevronRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeOverlay({
  reason,
  onStart,
  onSkip,
}: {
  reason: string | null;
  onStart: () => void;
  onSkip: () => void;
}) {
  const subtitle =
    reason === "returning_after_week"
      ? `欢迎回来，用这 ${STEPS.length} 步快速恢复工作状态`
      : `欢迎加入，按这 ${STEPS.length} 步完成基础配置`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="教师新手引导"
    >
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="bg-primary px-6 py-5 text-primary-foreground">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-foreground/15">
              <GraduationCap size={24} />
            </span>
            <div>
              <p className="text-base font-bold">教学工作快速上手</p>
              <p className="mt-0.5 text-xs text-primary-foreground/85">{subtitle}</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <ol className="space-y-3">
            {STEPS.map((item, index) => (
              <li key={item.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
              跳过
            </Button>
            <Button type="button" size="sm" onClick={onStart}>
              开始引导
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
