import { useEffect } from "react";

import { clearGuestSession } from "./guest-session";

export function CandidateDonePage() {
  useEffect(() => {
    clearGuestSession();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dcfce7,transparent_36%),#f8fafc] p-6">
      <section className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/90 p-8 text-center shadow-xl">
        <p className="text-sm font-medium text-emerald-700">提交成功</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">已交卷</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          感谢您参与本次考试。结果将由招聘方审阅，无需在此页面等待。
        </p>
      </section>
    </main>
  );
}
