import { useState } from "react";
import { Copy, Loader2, Plus, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";

interface CandidateRow {
  full_name: string;
  phone: string;
  email?: string;
}

interface InvitationCreated {
  user_id: string;
  invitation_id: string;
  invite_url: string;
}

interface Props {
  examId: string;
  onImported?: (items: InvitationCreated[]) => void;
}

export function ExternalCandidateImport({ examId, onImported }: Props) {
  const [rows, setRows] = useState<CandidateRow[]>([{ full_name: "", phone: "", email: "" }]);
  const [created, setCreated] = useState<InvitationCreated[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const updateRow = (index: number, patch: Partial<CandidateRow>) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => setRows((prev) => [...prev, { full_name: "", phone: "", email: "" }]);
  const removeRow = (index: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  };

  const submit = async () => {
    const valid = rows
      .map((row) => ({
        full_name: row.full_name.trim(),
        phone: row.phone.trim(),
        email: row.email?.trim() || undefined,
      }))
      .filter((row) => row.full_name && row.phone);
    if (valid.length === 0) {
      setError("请填写姓名和手机号");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const response = await apiClient.post<InvitationCreated[]>(
        `/api/exams/${examId}/invitations/bulk`,
        valid,
      );
      setCreated(response.data);
      onImported?.(response.data);
      toast({ title: "候选人邀请已生成", description: `已生成 ${response.data.length} 条邀请链接。` });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail ?? "导入失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({ title: "邀请链接已复制" });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border/50 bg-card/80 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">外部候选人</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            添加不在系统内的候选人，系统会生成一次性考试邀请链接。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={addRow}>
          <Plus className="h-4 w-4" />
          新增一行
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input
              aria-label={`候选人姓名 ${index + 1}`}
              placeholder="姓名"
              value={row.full_name}
              onChange={(event) => updateRow(index, { full_name: event.target.value })}
            />
            <Input
              aria-label={`候选人手机号 ${index + 1}`}
              placeholder="手机号"
              value={row.phone}
              onChange={(event) => updateRow(index, { phone: event.target.value })}
            />
            <Input
              aria-label={`候选人邮箱 ${index + 1}`}
              placeholder="邮箱（选填）"
              value={row.email ?? ""}
              onChange={(event) => updateRow(index, { email: event.target.value })}
            />
            <Button type="button" variant="ghost" onClick={() => removeRow(index)} disabled={rows.length <= 1}>
              <Trash2 className="h-4 w-4" />
              移除
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          添加候选人
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {created.length > 0 ? (
        <div className="space-y-2 rounded-xl bg-muted/30 p-3">
          <p className="text-sm font-medium text-foreground">本次生成的邀请链接</p>
          {created.map((item, index) => (
            <div
              key={item.invitation_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm"
            >
              <span className="truncate text-muted-foreground">候选人 {index + 1} · {item.invite_url}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => copyLink(item.invite_url)}>
                <Copy className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
