import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import { setGuestSession } from "./guest-session";

interface RedeemResponse {
  access_token: string;
  exam_id: string;
  candidate_name: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
    (error instanceof Error ? error.message : fallback)
  );
}

export function CandidatePublicLanding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "缺少公开链接令牌");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("缺少公开链接令牌");
      return;
    }
    if (!fullName.trim()) {
      setError("请填写姓名");
      return;
    }
    if (!phone.trim()) {
      setError("请填写手机号");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post<RedeemResponse>("/api/exam-public/redeem", {
        token,
        full_name: fullName.trim(),
        phone: phone.trim(),
      });
      setGuestSession(response.data.access_token, response.data.exam_id);
      navigate(`/exam-invite/take/${response.data.exam_id}`);
    } catch (err) {
      setError(getErrorMessage(err, "公开链接无效或已过期"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#dcfce7,transparent_32%),radial-gradient(circle_at_bottom_right,#dbeafe,transparent_34%),#f8fafc] p-6">
      <section className="w-full max-w-lg rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-2xl">
        <p className="text-sm font-medium text-primary">公开考试/练习链接</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">填写信息后进入</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          请填写真实姓名和手机号，提交后即可进入对应考试或练习。
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="public-candidate-name">姓名</Label>
            <Input
              id="public-candidate-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="请输入姓名"
              disabled={!token || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-candidate-phone">手机号</Label>
            <Input
              id="public-candidate-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="请输入手机号"
              disabled={!token || submitting}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={!token || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            进入考试/练习
          </Button>
        </form>
      </section>
    </main>
  );
}
