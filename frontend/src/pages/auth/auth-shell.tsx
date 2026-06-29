import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";

import { BrandLogoMark } from "@/components/brand-logo";
import { IcpRecordLink } from "@/components/icp-record-link";
import { useBrand } from "@/lib/brand";

interface AuthShellProps {
  children: ReactNode;
  cardClassName?: string;
}

export function AuthShell({ children, cardClassName }: AuthShellProps) {
  const brand = useBrand();
  const cardRef = useRef<HTMLElement | null>(null);

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const card = cardRef.current;
    if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const x = (event.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
    const y = (event.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
    card.style.setProperty("--auth-rotate-y", `${x * 4}deg`);
    card.style.setProperty("--auth-rotate-x", `${-y * 3}deg`);
  };

  const handlePointerLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.removeProperty("--auth-rotate-y");
    card.style.removeProperty("--auth-rotate-x");
  };

  return (
    <main
      className="auth-canvas"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="auth-aurora" aria-hidden="true">
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        <div className="auth-blob auth-blob-3" />
        <div className="auth-blob auth-blob-4" />
      </div>

      <div className="auth-exam-deco" aria-hidden="true">
        <span className="auth-symbol auth-symbol-sigma">∑</span>
        <span className="auth-symbol auth-symbol-pi">π</span>
        <span className="auth-symbol auth-symbol-cross">×</span>
        <span className="auth-mark-check">✓</span>
        <span className="auth-stamp">优秀</span>
        <span className="auth-comment">逻辑严密</span>
        <div className="auth-exam-progress">
          <div className="auth-exam-progress-header">
            <span className="auth-exam-dot" />
            <span>考试进行中</span>
          </div>
          <div className="auth-exam-timer">42:18</div>
          <div className="auth-exam-bar">
            <span />
          </div>
          <div className="auth-exam-meta">第 12 / 20 题</div>
        </div>
      </div>

      <section ref={cardRef} className={["auth-card", cardClassName].filter(Boolean).join(" ")}>
        <div className="auth-logo-row">
          <BrandLogoMark className="auth-logo-mark" />
          <span className="auth-logo-name">{brand.name}</span>
        </div>
        {children}
      </section>

      <footer className="auth-icp-footer" aria-label="网站备案信息">
        <IcpRecordLink />
      </footer>
    </main>
  );
}

export function AuthHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="auth-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}
