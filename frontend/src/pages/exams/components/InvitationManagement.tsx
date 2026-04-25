import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";

interface Invitation {
  id: string;
  user_id: string;
  candidate_name: string;
  candidate_phone: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

function statusLabel(invitation: Invitation): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (invitation.revoked_at) return { label: "已作废", variant: "destructive" };
  if (invitation.used_at) return { label: "已访问", variant: "default" };
  if (new Date(invitation.expires_at) < new Date()) return { label: "已过期", variant: "secondary" };
  return { label: "已发送", variant: "outline" };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InvitationManagement({ examId }: { examId: string }) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<Invitation[]>(`/api/exams/${examId}/invitations`);
      setItems(response.data);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      await apiClient.delete(`/api/exams/${examId}/invitations/${id}`);
      toast({ title: "邀请已作废" });
      await refresh();
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border/50 bg-card/90 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">邀请记录</h3>
          <p className="mt-1 text-sm text-muted-foreground">查看候选人邀请链接的访问、过期和作废状态。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载邀请记录...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
          暂无邀请记录
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">姓名</th>
                <th className="font-medium">手机号</th>
                <th className="font-medium">状态</th>
                <th className="font-medium">到期时间</th>
                <th className="text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const status = statusLabel(item);
                return (
                  <tr key={item.id} className="border-t border-border/50">
                    <td className="py-3 font-medium text-foreground">{item.candidate_name}</td>
                    <td className="text-muted-foreground">{item.candidate_phone}</td>
                    <td>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="text-muted-foreground">{formatDateTime(item.expires_at)}</td>
                    <td className="text-right">
                      {!item.revoked_at ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void revoke(item.id)}
                          disabled={revokingId === item.id}
                        >
                          {revokingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          作废
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
