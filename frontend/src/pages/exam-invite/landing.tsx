import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { setGuestSession } from "./guest-session";

interface RedeemResponse {
  access_token: string;
  exam_id: string;
  candidate_name: string;
}

export function CandidateLanding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<RedeemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("缺少邀请令牌");
      return;
    }

    apiClient
      .post<RedeemResponse>("/api/exam-invite/redeem", { token })
      .then((response) => {
        setState(response.data);
        setGuestSession(response.data.access_token, response.data.exam_id);
      })
      .catch((err) => {
        const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
        setError(detail ?? "邀请无效或已过期");
      });
  }, [params]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#e0f2fe,transparent_36%),#f8fafc] p-6">
        <div className="max-w-md rounded-3xl border border-border bg-background p-8 text-center shadow-xl">
          <h1 className="text-xl font-semibold text-foreground">无法进入考试</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/20 p-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在验证邀请...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_32%),radial-gradient(circle_at_bottom_right,#dcfce7,transparent_34%),#f8fafc] p-6">
      <section className="w-full max-w-lg rounded-[2rem] border border-white/70 bg-white/90 p-8 text-center shadow-2xl">
        <p className="text-sm font-medium text-primary">考试邀请已验证</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">欢迎，{state.candidate_name}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          请确认网络稳定，并在规定时间内独立完成考试。准备好后点击开始。
        </p>
        <Button className="mt-6" size="lg" onClick={() => navigate(`/exam-invite/take/${state.exam_id}`)}>
          开始考试
        </Button>
      </section>
    </main>
  );
}
